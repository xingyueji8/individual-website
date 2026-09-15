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
assert.match(js, /stage\.clientWidth >= 40/);
assert.match(js, /if \(!petPositioned\)[\s\S]*petX = maxX \/ 2;[\s\S]*petY = maxY/);
assert.match(js, /pet\.dataset\.moving = "true"/);
assert.match(js, /if \(!target\)[\s\S]*pet\.dataset\.state = "idle"/);
assert.match(js, /const speed = action === "run" \? 58 : 28/);
assert.match(js, /target\.distance \/ speed/);
assert.match(js, /function finishPetAction\(action, token\)/);
assert.match(js, /lastPetAction === "run" \|\| lastPetAction === "walk"/);
assert.match(js, /new MutationObserver/);
assert.match(js, /attributeFilter: \["class", "hidden"\]/);
assert.match(js, /sidebar\.addEventListener\("transitionend"/);
assert.match(css, /data-state="walk"\]\[data-moving="true"\]/);
assert.match(css, /data-state="run"\]\[data-moving="true"\]/);
assert.match(css, /--pet-easing: linear/);
assert.match(css, /agent-sit-cycle var\(--pet-action-duration\)[^;]*1 both/);
assert.match(css, /\.agent-pet \{[\s\S]*background: transparent !important;[\s\S]*box-shadow: none !important/);
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
