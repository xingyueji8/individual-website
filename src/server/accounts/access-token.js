// Cloudflare Access is optional. When enabled, the email must come from a signed
// application token issued for this exact Studio, not from a forwarded email header.
const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
function bytes(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error("invalid encoding");
  return Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
}
const jsonPart = part => JSON.parse(new TextDecoder().decode(bytes(part)));

export function createAccessVerifier(get = (...args) => fetch(...args)) {
  let cache;
  async function keys(issuer, kid) {
    const now = Date.now();
    if (!cache || cache.issuer !== issuer) cache = { issuer, values: new Map(), expires: 0, retry: 0 };
    const state = cache;
    if (state.expires > now && state.values.has(kid)) return state.values;
    if (!state.pending && state.retry <= now) {
      state.retry = now + 30_000;
      state.pending = (async () => {
        const res = await get(issuer + "/cdn-cgi/access/certs", { redirect:"error", signal:AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error("key service unavailable");
        const jwks = (await res.json()).keys;
        if (!Array.isArray(jwks)) throw new Error("invalid key set");
        state.values = new Map(jwks.filter(k => k.kty === "RSA" && k.kid && (!k.use || k.use === "sig") &&
          (!k.alg || k.alg === "RS256") && k.n && k.e).map(k => [k.kid,k]));
        state.expires = Date.now() + 300_000;
      })().finally(() => { state.pending = null; });
    }
    if (state.pending) await state.pending;
    return state.expires > Date.now() ? state.values : new Map();
  }
  return async function verifiedAccessEmail(token, domain, audience) {
    try {
      if (typeof token !== "string" || token.length > 16384 || !audience || !domain) return null;
      const url = new URL(domain.startsWith("https://") ? domain : "https://" + domain);
      if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(url.origin) || url.username || url.password || url.href !== url.origin + "/") return null;
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const head = jsonPart(parts[0]), claims = jsonPart(parts[1]);
      const now = Date.now() / 1000;
      if (head.alg !== "RS256" || head.crit || typeof head.kid !== "string" || !head.kid || head.kid.length > 256 ||
        claims.iss !== url.origin || !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(audience) ||
        claims.type !== "app" || !Number.isFinite(claims.exp) || claims.exp <= now ||
        (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now)) ||
        typeof claims.email !== "string" || !claims.email.trim() || claims.email.length > 320) return null;
      const jwk = (await keys(url.origin,head.kid)).get(head.kid);
      if (!jwk) return null;
      const key = await crypto.subtle.importKey("jwk",jwk,algorithm,false,["verify"]);
      const ok = await crypto.subtle.verify(algorithm,key,bytes(parts[2]),new TextEncoder().encode(parts[0]+"."+parts[1]));
      return ok && claims.exp > Date.now()/1000 ? claims.email.trim().toLowerCase() : null;
    } catch { return null; }
  };
}
export const verifiedAccessEmail = createAccessVerifier();
