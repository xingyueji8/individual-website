import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const window = parseHTML(`<!doctype html><html><body>
  <div class="app-shell">
    <aside class="sidebar">
      <nav class="nav"></nav>
      <div class="sidebar-note"></div>
    </aside>
  </div>
  <div id="chat-messages"></div>
  <form id="chat-form"><textarea id="chat-input"></textarea><button type="submit">Send</button></form>
  <div id="chat-status"></div>
</body></html>`);
const { document, HTMLElement } = window;
const rect = (left, top, width, height) => ({
  left, top, right: left + width, bottom: top + height, width, height, x: left, y: top,
  toJSON() { return this; },
});
const number = (value, fallback = 0) => Number.parseFloat(value) || fallback;

Object.defineProperties(HTMLElement.prototype, {
  offsetWidth: {
    configurable: true,
    get() {
      if (this.classList?.contains("agent-pet")) return 58;
      if (this.classList?.contains("agent-dialog")) return number(this.style.width, 286);
      return 0;
    },
  },
  offsetHeight: {
    configurable: true,
    get() {
      if (this.classList?.contains("agent-pet")) return 105;
      if (this.classList?.contains("agent-dialog")) return number(this.style.height, 180);
      return 0;
    },
  },
  clientWidth: {
    configurable: true,
    get() { return this.classList?.contains("agent-pet-stage") ? 194 : this.offsetWidth; },
  },
  clientHeight: {
    configurable: true,
    get() { return this.classList?.contains("agent-pet-stage") ? 374 : this.offsetHeight; },
  },
});

HTMLElement.prototype.getBoundingClientRect = function () {
  if (this.classList?.contains("sidebar")) return rect(0, 0, 220, 600);
  if (this.classList?.contains("nav")) return rect(0, 40, 220, 120);
  if (this.classList?.contains("sidebar-note")) return rect(0, 560, 220, 40);
  if (this.classList?.contains("agent-pet-stage")) return rect(13, 180, 194, 374);
  if (this.classList?.contains("agent-pet")) {
    const detached = this.classList.contains("is-detached");
    const host = detached ? this : this.parentElement;
    const x = number(host.style.getPropertyValue("--pet-x"));
    const y = number(host.style.getPropertyValue("--pet-y"));
    return rect((detached ? 0 : 13) + x, (detached ? 0 : 180) + y, 58, 105);
  }
  if (this.classList?.contains("agent-dialog")) {
    return rect(number(this.style.left, 10), number(this.style.top, 10), this.offsetWidth, this.offsetHeight);
  }
  return rect(0, 0, this.offsetWidth, this.offsetHeight);
};

let timerId = 0;
const timers = new Map();
const randomValues = [];
const deterministicMath = Object.create(Math);
deterministicMath.random = () => randomValues.length ? randomValues.shift() : .5;
const context = vm.createContext({
  window,
  document,
  console,
  Element: window.Element,
  HTMLElement,
  Event: window.Event,
  MutationObserver: class { observe() {} },
  ResizeObserver: class { observe() {} },
  AbortController,
  Math: deterministicMath,
  innerWidth: 1200,
  innerHeight: 800,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  requestAnimationFrame: callback => { callback(0); return 1; },
  setTimeout: (callback, delay = 0) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
  clearTimeout: id => timers.delete(id),
  addEventListener: window.addEventListener.bind(window),
  hasFullAccess: () => true,
  showAuthLock() {},
  api: async () => ({}),
  streamAiAnswer: async () => {},
  typesetAiBubble: async () => {},
  addBubble: () => document.createElement("div"),
  protectedMediaUrl: value => value,
  openContent: async () => {},
  downloadCurrentContentPdf: async () => {},
});

vm.runInContext(await readFile("public/site-agent.js", "utf8"), context);
const pet = document.getElementById("agent-pet-control");
const stage = document.querySelector(".agent-pet-stage");
const panel = document.querySelector(".agent-dialog");
assert.ok(pet && stage && panel);
assert.equal(pet.parentElement, stage);
assert.equal(panel.querySelectorAll(".agent-resize-handle").length, 8);

function pointer(type, x, y, pointerId = 1, target = window) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: x },
    clientY: { value: y },
    button: { value: 0 },
    isPrimary: { value: true },
  });
  target.dispatchEvent(event);
  return event;
}

function transitionEnd() {
  const event = new window.Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: "transform" });
  pet.dispatchEvent(event);
}

function runOnlyTimer() {
  assert.equal(timers.size, 1);
  const [id, timer] = timers.entries().next().value;
  timers.delete(id);
  timer.callback();
}

/* A running pose always carries a real horizontal trip and turns inward at the next edge. */
randomValues.push(.36, .25, .5, .5);
runOnlyTimer();
assert.equal(pet.dataset.state, "run");
assert.equal(pet.dataset.moving, "true");
assert.ok(pet.classList.contains("is-facing-left"));
const firstTarget = number(stage.style.getPropertyValue("--pet-x"));
assert.ok(firstTarget <= 5);
transitionEnd();
assert.equal(pet.dataset.state, "idle");
assert.equal(pet.dataset.moving, "false");

randomValues.push(.9, .5, .5);
runOnlyTimer();
assert.equal(pet.dataset.state, "walk");
assert.equal(pet.dataset.moving, "true");
assert.ok(!pet.classList.contains("is-facing-left"));
assert.ok(number(stage.style.getPropertyValue("--pet-x")) > firstTarget + 20);
transitionEnd();

/* Dragging outside the sidebar reparents the control and freezes the seated pose. */
let petRect = pet.getBoundingClientRect();
pointer("pointerdown", petRect.left + 29, petRect.top + 52, 2, pet);
pointer("pointermove", 630, 330, 2);
pointer("pointerup", 630, 330, 2);
assert.equal(pet.parentElement, document.body);
assert.ok(pet.classList.contains("is-detached"));
assert.equal(pet.dataset.state, "sit");
assert.equal(pet.dataset.moving, "false");

runOnlyTimer();
pet.click();
assert.equal(panel.hidden, false);
assert.equal(pet.dataset.state, "wave");
window.SiteAgent.close();
assert.equal(pet.dataset.state, "sit");

/* Dropping the center into the blank sidebar area docks the pet and resumes activity. */
petRect = pet.getBoundingClientRect();
pointer("pointerdown", petRect.left + 29, petRect.top + 52, 3, pet);
pointer("pointermove", 100, 300, 3);
pointer("pointerup", 100, 300, 3);
assert.equal(pet.parentElement, stage);
assert.ok(!pet.classList.contains("is-detached"));
assert.equal(pet.dataset.state, "idle");

/* Every edge/corner exists, and a southeast drag changes both dimensions. */
window.SiteAgent.open();
const southeast = panel.querySelector(".agent-resize-handle.is-se");
let panelRect = panel.getBoundingClientRect();
pointer("pointerdown", panelRect.right, panelRect.bottom, 4, southeast);
pointer("pointermove", panelRect.right + 90, panelRect.bottom + 70, 4);
pointer("pointerup", panelRect.right + 90, panelRect.bottom + 70, 4);
assert.equal(number(panel.style.width), 376);
assert.equal(number(panel.style.height), 250);
assert.ok(panel.classList.contains("is-user-sized"));

console.log("site agent movement, full-screen drag, seated docking and dialog resizing tests passed");
