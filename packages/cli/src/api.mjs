import { resolveBackend } from "./config.mjs";

export const HEALTH_TIMEOUT_MS = 1500;
const DEFAULT_TIMEOUT_MS = 5000;

/** Internal: wrap fetch with timeout + structured result. */
async function request(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (err) {
    clearTimeout(t);
    if (err && err.name === "AbortError") {
      return {
        ok: false,
        error: "backend_unreachable",
        message: `request to ${url} timed out (${timeoutMs}ms)`,
      };
    }
    return {
      ok: false,
      error: "backend_unreachable",
      message: (err && err.message) || String(err),
    };
  }
  clearTimeout(t);

  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  let body = null;
  try {
    body = isJson ? await res.json() : await res.text();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code =
      body && typeof body === "object" && body.error
        ? String(body.error)
        : "backend_error";
    const msgRaw =
      body && typeof body === "object" && (body.message || body.detail);
    const msg =
      typeof msgRaw === "string"
        ? msgRaw
        : msgRaw !== undefined
          ? JSON.stringify(msgRaw)
          : res.statusText || `HTTP ${res.status}`;
    return { ok: false, status: res.status, error: code, message: msg, body };
  }
  return { ok: true, status: res.status, json: body };
}

export function buildUrl(backendArg, path) {
  const backend = resolveBackend(backendArg).replace(/\/+$/, "");
  return backend + path;
}

export function apiGet(backendArg, path, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return request(buildUrl(backendArg, path), { method: "GET" }, timeoutMs);
}

export function apiPost(backendArg, path, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return request(
    buildUrl(backendArg, path),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    timeoutMs,
  );
}

export function apiDelete(backendArg, path, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return request(
    buildUrl(backendArg, path),
    { method: "DELETE" },
    timeoutMs,
  );
}

/** Print a structured error from a non-ok api result. Returns the exit code
 *  the caller should propagate (2 for unreachable, 1 for everything else). */
export function printError(result) {
  const code = result.error || "unknown_error";
  process.stderr.write(`error: ${code}\n`);
  if (result.message) {
    process.stderr.write(`${result.message}\n`);
  }
  if (code === "backend_unreachable") return 2;
  return 1;
}
