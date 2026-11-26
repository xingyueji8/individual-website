/** 域名、HTTPS、写请求来源和 JSON 请求体检查。 */
import { HttpError, SECURITY_HEADERS, textResponse } from "./responses.js";
import { clampText } from "../shared/values.js";

const DEFAULT_CANONICAL_HOSTNAME = "xingyueji.com.cn";

const DEFAULT_ALLOWED_HOSTNAMES = Object.freeze([DEFAULT_CANONICAL_HOSTNAME, `www.${DEFAULT_CANONICAL_HOSTNAME}`]);

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function configuredAllowedHostnames(env) {
  const configured = String(env?.ALLOWED_HOSTNAMES || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const canonical = clampText(env?.CANONICAL_HOSTNAME || DEFAULT_CANONICAL_HOSTNAME, 253).toLowerCase();
  return {
    canonical,
    allowed: new Set([canonical, ...(configured.length ? configured : DEFAULT_ALLOWED_HOSTNAMES)]),
  };
}

function localRequestHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return LOCAL_HOSTNAMES.has(normalized) || normalized.endsWith(".localhost");
}

export function requestGateResponse(url, env) {
  const hostname = url.hostname.toLowerCase();
  if (localRequestHostname(hostname)) return null;
  const { canonical, allowed } = configuredAllowedHostnames(env);
  if (!allowed.has(hostname)) return textResponse("请求入口无效", 421);
  if (url.protocol === "https:" && hostname === canonical) return null;

  const target = new URL(url);
  target.protocol = "https:";
  target.hostname = canonical;
  target.port = "";
  return new Response(null, {
    status: 308,
    headers: {
      ...SECURITY_HEADERS,
      "Cache-Control": "no-store",
      "Location": target.toString(),
    },
  });
}

export function rejectCrossSiteMutation(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const site = String(request.headers.get("Sec-Fetch-Site") || "").toLowerCase();
  if (site && !["same-origin", "none"].includes(site)) {
    throw new HttpError(403, "拒绝跨站请求");
  }
  const origin = request.headers.get("Origin");
  if (!origin) return;
  let originUrl;
  try { originUrl = new URL(origin); } catch { throw new HttpError(403, "请求来源无效"); }
  if (originUrl.origin !== new URL(request.url).origin) throw new HttpError(403, "拒绝跨站请求");
}

export async function readJson(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "请求格式必须是 JSON");
  }
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "JSON 内容格式错误");
  }
}
