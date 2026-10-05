import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const [html, agentSource, themeSource] = await Promise.all([
  readFile("public/index.html", "utf8"), readFile("public/site-agent.js", "utf8"), readFile("public/theme.js", "utf8"),
]);
const permanentKey = "xyj_desktop_assistant_hidden";
const sessionKey = "xyj_desktop_assistant_hidden_session";
const persistent = new Map();
const visit = new Map();
const storage = data => ({ getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) });

// Each load gets a fresh DOM and script instance, while browser/visit storage
// is retained independently. This exercises real controls and reload behavior.
function loadAgent(session = visit, blockedStorage = false) {
  const window = parseHTML(html);
  const { document, HTMLElement } = window;
  document.querySelector(".app-shell").hidden = false;
  const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: { configurable: true, get() { return this.classList.contains("agent-pet") ? 58 : 286; } },
    offsetHeight: { configurable: true, get() { return this.classList.contains("agent-pet") ? 105 : 180; } },
    clientWidth: { configurable: true, get() { return 194; } },
    clientHeight: { configurable: true, get() { return 374; } },
  });
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains("sidebar")) return rect(0, 0, 220, 600);
    if (this.classList.contains("nav")) return rect(0, 40, 220, 120);
    if (this.classList.contains("sidebar-note")) return rect(0, 560, 220, 40);
    return rect(13, 180, this.offsetWidth, this.offsetHeight);
  };
  HTMLElement.prototype.showModal = function () { this.open = true; this.setAttribute("open", ""); };
  HTMLElement.prototype.close = function () { this.open = false; this.removeAttribute("open"); this.dispatchEvent(new window.Event("close")); };
  const timers = new Map(); let nextTimer = 0;
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  const unavailable = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  const context = vm.createContext({
    window, document, console, Element: window.Element, HTMLElement, CustomEvent: window.CustomEvent,
    MutationObserver: class { observe() {} }, ResizeObserver: class { observe() {} }, AbortController,
    innerWidth: 1200, innerHeight: 800, matchMedia: window.matchMedia,
    localStorage: blockedStorage ? unavailable : storage(persistent), sessionStorage: blockedStorage ? unavailable : storage(session),
    requestAnimationFrame: callback => { callback(0); return 1; },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id),
    addEventListener: window.addEventListener.bind(window), hasFullAccess: () => true, showAuthLock() {}, api: async () => ({}),
  });
  vm.runInContext(themeSource, context);
  vm.runInContext(agentSource, context);
  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  return {
    window, document, timers, pet: document.getElementById("agent-pet-control"),
    stage: document.querySelector(".agent-pet-stage"), panel: document.querySelector(".agent-dialog"),
    petSwitch: document.querySelector(".agent-dialog [data-desktop-assistant-switch]"),
    mainSwitch: document.getElementById("agent-desktop-restore-switch"),
    choice: document.getElementById("desktop-assistant-close-dialog"), notice: document.getElementById("desktop-assistant-notice-dialog"),
  };
}
function assertVisibility(app, visible) {
  assert.equal(app.pet.hidden, !visible);
  assert.equal(app.stage.hidden, !visible);
  for (const button of [app.petSwitch, app.mainSwitch]) {
    assert.equal(button.getAttribute("aria-checked"), String(visible));
    assert.equal(button.classList.contains("is-on"), visible);
    assert.equal(button.classList.contains("night-mode-switch"), true);
    assert.equal(button.hasAttribute("data-theme-switch-button"), false);
  }
  if (!visible) {
    assert.equal(app.panel.hidden, true);
    assert.equal(app.document.querySelector(".agent-composer").hidden, true);
    assert.equal(app.pet.dataset.moving, "false");
    assert.equal(app.timers.size, 0, "disabled characters must stop their activity timers");
  }
}
function choose(app, mode) {
  app.choice.querySelector(`[data-desktop-assistant-close="${mode}"]`).click();
  assert.equal(app.choice.open, false);
  assert.equal(app.notice.open, true);
  assert.match(app.notice.textContent, /您可在‘AI助手’板块通过按钮再次打开。/);
  assertVisibility(app, false);
}

const first = loadAgent();
assertVisibility(first, true);
first.pet.click();
assert.equal(first.panel.hidden, false);
first.petSwitch.click();
assert.equal(first.choice.open, true);
first.choice.querySelector("[data-desktop-assistant-cancel]").click();
assertVisibility(first, true);
assert.ok(!first.notice.open, "cancelling must not show a closed-assistant notice");
first.petSwitch.click();
choose(first, "session");
assert.equal(visit.get(sessionKey), "1");
assert.equal(persistent.has(permanentKey), false);
first.window.SiteAgent.open();
assertVisibility(first, false);
first.window.dispatchEvent(new first.window.Event("resize"));
assertVisibility(first, false);
assertVisibility(loadAgent(), false); // Refresh in the same visit.
const nextVisit = loadAgent(new Map());
assertVisibility(nextVisit, true); // The original tab was closed.

first.notice.querySelector("[data-desktop-assistant-dismiss]").click();
first.mainSwitch.click();
assertVisibility(first, true);
assert.equal(visit.has(sessionKey), false);
assert.equal(persistent.has(permanentKey), false);

// Hiding from the AI page follows the same confirmation/reminder sequence.
nextVisit.mainSwitch.click();
choose(nextVisit, "permanent");
assert.equal(persistent.get(permanentKey), "1");
const later = loadAgent(new Map());
assertVisibility(later, false);
later.mainSwitch.click();
assertVisibility(later, true);
assert.equal(persistent.has(permanentKey), false);
assertVisibility(loadAgent(new Map()), true);

// The reused night-mode skin must not couple visibility to the color theme.
const themeButton = later.document.querySelector("[data-theme-switch-button]");
themeButton.click();
assert.equal(later.document.documentElement.dataset.theme, "dark");
assertVisibility(later, true);
later.mainSwitch.click(); choose(later, "session");
assert.equal(later.document.documentElement.dataset.theme, "dark");

// Permanent choices changed in another tab update appearance without opening
// an unsolicited reminder. Restore in that tab clears the saved preference.
const synced = loadAgent(new Map());
persistent.set(permanentKey, "1");
function storageEvent(key) {
  const event = new synced.window.Event("storage"); Object.defineProperty(event, "key", { value: key }); synced.window.dispatchEvent(event);
}
storageEvent(permanentKey); assertVisibility(synced, false); assert.ok(!synced.notice.open);
persistent.delete(permanentKey); storageEvent(permanentKey); assertVisibility(synced, true);

const restricted = loadAgent(new Map(), true);
restricted.mainSwitch.click(); choose(restricted, "permanent");
restricted.notice.querySelector("[data-desktop-assistant-dismiss]").click();
restricted.mainSwitch.click(); assertVisibility(restricted, true);

console.log("desktop assistant cancellation, visit/permanent preferences, reload, restore, theme independence and timer shutdown passed");
