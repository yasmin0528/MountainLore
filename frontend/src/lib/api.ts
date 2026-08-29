// Keep browser requests same-origin. Next.js proxies this path to FastAPI,
// so the visitor cookie remains attached when the app is opened through LAN IPs.
const apiBase = "/api";

/**
 * `crypto.randomUUID` is only guaranteed in secure browser contexts.  The
 * LAN development address uses plain HTTP, so provide a client-side fallback
 * for request and upload identifiers instead of failing before `fetch` runs.
 */
export function createRequestId(prefix = "request"): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

/** HTTP header values cannot carry a raw UTF-8 filename. */
export function encodeFileNameForHeader(fileName: string): string {
  return encodeURIComponent(fileName);
}

type ApiFailure = { error?: { message?: string }; detail?: string | { message?: string } };

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  const raw = await response.text();
  let payload: T & ApiFailure;
  try {
    payload = JSON.parse(raw) as T & ApiFailure;
  } catch {
    if (!response.ok) {
      throw new ApiError(`服务返回异常（HTTP ${response.status}）`);
    }
    throw new ApiError("服务返回了无法读取的数据。");
  }
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : payload.detail?.message;
    throw new ApiError(payload.error?.message ?? detail ?? `请求失败（HTTP ${response.status}）`);
  }
  return payload;
}
