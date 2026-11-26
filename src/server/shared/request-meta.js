/** 读取请求 Cookie 和访客来源元数据；IP 只在服务端处理。 */
import { sha256 } from "./crypto.js";
import { clampText } from "./values.js";

export function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const prefix = `${name}=`;
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return "";
}

function maskIp(ip) {
  const value = String(ip || "").trim();
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    const parts = value.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
  }
  if (value.includes(":")) return `${value.split(":").slice(0, 4).join(":")}::`;
  return "未知";
}

export async function clientMeta(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return {
    ipHash: await sha256(ip),
    ipHint: maskIp(ip),
    userAgent: clampText(request.headers.get("User-Agent"), 300),
  };
}

export function shareVisitorCookie(value = "1", maxAge = 86400) {
  return `xyj_share=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function safeReferrerHost(request) {
  const value = clampText(request.headers.get("Referer"), 600);
  if (!value) return "";
  try { return clampText(new URL(value).hostname, 160); }
  catch { return ""; }
}

export async function guestRequestMeta(request) {
  const base = await clientMeta(request);
  const cf = request.cf || {};
  return {
    ...base,
    country: clampText(cf.country, 12),
    region: clampText(cf.region, 100),
    city: clampText(cf.city, 100),
    timezone: clampText(cf.timezone, 80),
    asn: Number.isFinite(Number(cf.asn)) ? Number(cf.asn) : 0,
    asOrganization: clampText(cf.asOrganization, 180),
    referrer: safeReferrerHost(request),
  };
}
