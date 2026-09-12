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
assert.match(html, /streamAiAnswer\(question, bubble, signal\)/);
assert.match(js, /\/api\/agent\/confirm/);
assert.match(js, /confirm: true/);
assert.match(js, /选择下载/);
assert.match(js, /确认下载/);
assert.match(js, /\/api\/agent\/cancel/);
assert.match(js, /controller\?\.abort\(\)/);
assert.match(js, /pending\.has\(token\)/);
assert.match(js, /name\.textContent = item\.title/);
assert.match(js, /agent-companion\.png/);
assert.match(css, /\.agent-pet-stage/);
assert.match(css, /backdrop-filter/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /hover:none/);
assert.match(worker, /requireApprovedUser\(request, env\)/);
assert.match(worker, /consumeAgentAction/);
assert.match(worker, /contentSecurity\(request, env\)/);

console.log("site agent UI integration tests passed");
