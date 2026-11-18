import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { Miniflare } from "miniflare";
import { createAccessVerifier } from "../src/admin-access.mjs";
import { qqRecipientBinding } from "../src/qq-recipient.mjs";

for (const [sender, fixed, saved, checked, expected] of [
  ["owner","","",false,"denied"], ["owner","","",true,"save"],
  ["owner","","old",false,"denied"], ["owner","","old",true,"save"],
  ["owner","","owner",false,"unchanged"], ["other","owner","",true,"fixed-other"],
  ["owner","owner","",false,"unchanged"],
]) assert.equal(qqRecipientBinding(sender,fixed,saved,checked),expected);

// Isolated identity-provider fixture. Only the synthetic provider's public key
// is supplied to the verifier; no real credentials or remote service is used.
const alg = {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256",modulusLength:2048,publicExponent:new Uint8Array([1,0,1])};
const pair = await crypto.subtle.generateKey(alg,true,["sign","verify"]);
const jwk = {...await crypto.subtle.exportKey("jwk",pair.publicKey),kid:"fixture-key"};
const issuer = "https://fixture.cloudflareaccess.com", aud = "fixture-studio", now = Math.floor(Date.now()/1000);
let lookups = 0;
const verify = createAccessVerifier(async url => {
  assert.equal(url,issuer+"/cdn-cgi/access/certs");lookups++;return Response.json({keys:[jwk]});
});
const part = obj => Buffer.from(JSON.stringify(obj)).toString("base64url");
async function fixture(overrides = {}) {
  const data = part({alg:"RS256",kid:jwk.kid})+"."+part({type:"app",aud:[aud],iss:issuer,
    email:"Owner@example.org",nbf:now-20,exp:now+120,...overrides});
  return data+"."+Buffer.from(await crypto.subtle.sign(alg,pair.privateKey,new TextEncoder().encode(data))).toString("base64url");
}
const good = await fixture();
assert.equal(await verify(good,issuer,aud),"owner@example.org");
assert.equal(await verify(good,issuer,aud),"owner@example.org");assert.equal(lookups,1);
for(const claims of [{aud:"other-app"},{iss:"https://other.cloudflareaccess.com"},{exp:now-10},{nbf:now+120},{type:"org"}]) {
  assert.equal(await verify(await fixture(claims),issuer,aud),null);
}
const unavailable = createAccessVerifier(async () => new Response(null,{status:503}));
assert.equal(await unavailable(good,issuer,aud),null);
const unknownKey = createAccessVerifier(async () => Response.json({keys:[]}));
assert.equal(await unknownKey(good,issuer,aud),null);
const other = await crypto.subtle.generateKey(alg,true,["sign","verify"]);
const unrelatedKey = createAccessVerifier(async () => Response.json({keys:[{...await crypto.subtle.exportKey("jwk",other.publicKey),kid:jwk.kid}]}));
assert.equal(await unrelatedKey(good,issuer,aud),null);
assert.equal(await verify(null,issuer,aud),null);

const viewer = await readFile("public/document-viewer.html","utf8");
const document = parseHTML("<html></html>").document;
const sanitizer = vm.runInNewContext(viewer.slice(viewer.indexOf("function sanitizedDocument("),viewer.indexOf("async function start()")) + ";sanitizedDocument", { document });
const tree = sanitizer('<h2 id="part">标题</h2><table><tr><td colspan="2" data-extra="unused">内容</td></tr></table><p><a href="#part">返回</a><a href="https://example.org/">资料</a><img src="data:image/png;base64,AAAA" alt="图"><img src="https://example.org/external.png"></p>');
assert.equal(tree.querySelector("h2").id, "doc-part");
assert.equal(tree.querySelector("td").getAttribute("colspan"), "2");
assert.equal(tree.querySelector("td").hasAttribute("data-extra"), false);
assert.equal(tree.querySelector("a").getAttribute("href"), "#doc-part");
assert.equal(tree.querySelectorAll("a")[1].getAttribute("rel"), "noopener noreferrer");
assert.equal(tree.querySelectorAll("img").length, 1);

const mf = new Miniflare({ modules:true,cf:false,scriptPath:"src/worker.js",compatibilityDate:"2026-08-06",
  bindings: { QQ_BOT_SECRET:"fixture-only", QQ_BOT_APP_ID:"test-app" } });
try {
  const config = {method:"POST", headers:{"Content-Type":"application/json","X-Bot-Appid":"test-app"},
    body:JSON.stringify({op:13,d:{event_ts:String(Math.floor(Date.now()/1000)),plain_token:"integration-test"}})};
  assert.equal((await mf.dispatchFetch("https://localhost/api/qq/events",config)).status,403);
} finally {await mf.dispose();}
console.log("notification and document preview boundaries passed");
