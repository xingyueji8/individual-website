import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, js, css, worker] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/site-agent.js", import.meta.url), "utf8"),
  readFile(new URL("../public/site-agent.css", import.meta.url), "utf8"),
  readFile(new URL("../src/worker.js", import.meta.url), "utf8"),
]);

assert.match(html, /site-agent\.css/);
assert.match(html, /site-agent\.js/);
assert.match(html, /window\.SiteAgent\?\.close/);
assert.match(html, /SiteAgent\.submit\(document\.getElementById\("chat-input"\)\)/);
assert.match(html, /streamAiAnswer\(question, bubble, signal\)/);
assert.match(js, /\/api\/agent\/confirm/);
assert.match(js, /confirm: true/);
assert.match(js, /选择下载/);
assert.match(js, /确认下载/);
assert.match(js, /\/api\/agent\/cancel/);
assert.match(js, /controller\?\.abort\(\)/);
assert.match(js, /pending\.has\(token\)/);
assert.match(js, /name\.textContent = item\.title/);
assert.match(css, /agent-companion-sprites-v2\.png/);
assert.match(js, /pet\.dataset\.state = "idle"/);
for (const state of ["walk", "run", "wave", "jump", "sit"]) assert.match(css, new RegExp(`data-state="${state}"`));
for (const cycle of ["walk", "run", "wave", "jump", "sit"]) assert.match(css, new RegExp(`@keyframes agent-${cycle}-cycle`));
assert.match(js, /function freezePetMotion\(\)/);
assert.match(js, /pet\.addEventListener\("pointerenter", greetPet\)/);
assert.match(js, /pet\.addEventListener\("pointerleave", finishGreeting\)/);
assert.match(js, /pet\.addEventListener\("pointerdown", freezePetMotion\)/);
assert.doesNotMatch(js, /agent-pet-hint/);
assert.match(css, /\.agent-pet-stage::before,[\s\S]*content:none !important/);
assert.match(html, /!control\.matches\(":disabled, \.image-nav, \.agent-pet"\)/);
assert.match(css, /\.app-shell\.sidebar-collapsed \.sidebar > \.agent-pet-stage/);
assert.doesNotMatch(css, /\.app-shell\.sidebar-collapsed \.agent-pet-stage \{ opacity: 0/);
assert.match(js, /navRect\.bottom - sidebarRect\.top \+ 20/);
assert.match(js, /stage\.clientWidth >= \(collapsed \? 54 : 72\)/);
assert.doesNotMatch(js, /oldShell\.replaceWith/);
assert.doesNotMatch(js, /data-section="ai-helper"[\s\S]*stopImmediatePropagation/);
assert.match(css, /\.agent-pet-stage/);
assert.match(css, /\.sidebar > \.agent-pet-stage \{[\s\S]*position: absolute/);
assert.doesNotMatch(css, /flex:\s*1\s+1\s+150px/);
assert.match(css, /width: min\(286px/);
assert.match(css, /backdrop-filter/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /hover:none/);
assert.match(worker, /requireApprovedUser\(request, env\)/);
assert.match(worker, /consumeAgentAction/);
assert.match(worker, /contentSecurity\(request, env\)/);

console.log("site agent UI integration tests passed");
