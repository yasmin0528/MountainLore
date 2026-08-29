// Keep browser requests same-origin. Next.js proxies this path to FastAPI,
// so the visitor cookie remains attached when the app is opened through LAN IPs.
const apiBase = "/api";

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
