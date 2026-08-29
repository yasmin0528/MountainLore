// Temporary diagnostic script: drive headless Edge via CDP to test menu clicks.
import { spawn } from "node:child_process";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9222;
const URL = "http://127.0.0.1:3000/";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(EDGE, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  "--user-data-dir=" + process.env.TEMP + "\\edge-cdp-test-profile",
  "--no-first-run",
  "--disable-gpu",
  "about:blank",
], { stdio: "ignore" });

let ws;
let msgId = 0;
const pending = new Map();
const consoleLogs = [];
const exceptions = [];

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

async function waitForTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not ready yet */ }
    await sleep(250);
  }
  throw new Error("CDP target not found");
}

async function main() {
  const wsUrl = await waitForTarget();
  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      consoleLogs.push(`[console.${msg.params.type}] ${text}`);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      exceptions.push(msg.params.exceptionDetails?.exception?.description || JSON.stringify(msg.params.exceptionDetails));
    }
  };

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: URL });
  await sleep(6000); // let it load + hydrate + run init API calls

  const evalJs = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) return `EVAL-ERROR: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`;
    return result.result.value;
  };

  const snapshot = (label) => evalJs(`(() => {
    const main = document.querySelector("main.workspace");
    const firstHeading = main?.querySelector("h1")?.textContent?.trim() || "(no h1)";
    const empty = main?.querySelector(".empty-state p")?.textContent?.trim() || "";
    const active = document.querySelector("nav .stage-current span")?.textContent?.trim() || "";
    const mainHtmlLen = main ? main.innerHTML.length : 0;
    return JSON.stringify({ label: ${JSON.stringify(label)}, firstHeading, empty, active, mainHtmlLen });
  })()`);

  console.log("== initial state ==");
  console.log(await snapshot("initial"));

  const clickMenu = async (label) => {
    const before = await snapshot(label + " (before)");
    await evalJs(`(() => {
      const buttons = [...document.querySelectorAll("nav .stage")];
      const target = buttons.find((b) => b.textContent.includes(${JSON.stringify(label)}));
      if (!target) return "button-not-found";
      target.click();
      return "clicked";
    })()`);
    await sleep(1500);
    const after = await snapshot(label + " (after)");
    console.log(before);
    console.log(after);
    console.log("---");
  };

  console.log("== clicking menus ==");
  await clickMenu("观潮");
  await clickMenu("出山");
  await clickMenu("采风");
  await clickMenu("档案");

  // Also test the project-chip button specifically
  await evalJs(`document.querySelector(".project-chip")?.click(); "chip-clicked"`);
  await sleep(1500);
  console.log(await snapshot("档案chip (after)"));

  console.log("== console logs during session ==");
  console.log(consoleLogs.length ? consoleLogs.join("\n") : "(none)");
  console.log("== uncaught exceptions ==");
  console.log(exceptions.length ? exceptions.join("\n---\n") : "(none)");
}

try {
  await main();
} catch (error) {
  console.error("SCRIPT-ERROR:", error.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill();
  process.exit(0);
}
