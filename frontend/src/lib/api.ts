// Keep browser requests same-origin. Next.js proxies this path to FastAPI,
// so the visitor cookie remains attached when the app is opened through LAN IPs.
const apiBase = "/api";

type ApiFailure = { error?: { message?: string } };

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
  const payload = (await response.json()) as T & ApiFailure;
  if (!response.ok) {
    throw new ApiError(payload.error?.message ?? "请求没有成功，请稍后再试。");
  }
  return payload;
}
