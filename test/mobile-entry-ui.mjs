import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const entrySource = await readFile("public/entry-auth.js", "utf8");
const index = await readFile("public/index.html", "utf8");
const themeSource = await readFile("public/theme.js", "utf8");
const draftKey = "xyj_entry_form_draft";
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function environment(stored = new Map(), navigator = {}) {
  const window = parseHTML(index);
  Object.defineProperty(window.HTMLInputElement.prototype, "checked", {
    configurable: true, get() { return this.hasAttribute("checked"); },
    set(value) { this.toggleAttribute("checked", Boolean(value)); },
  });
  const timers = new Map(); let timerId = 0;
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  const context = vm.createContext({ window, document: window.document, navigator,
    AbortController, console,
    sessionStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(entrySource, context);
  const node = id => window.document.getElementById(id);
  return { window, context, stored, node, api: window.XYJEntryAuth,
    fire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.callback(); } },
  };
}

// Real form events survive a reload in this tab, including unchecked choices.
const stored = new Map();
const first = environment(stored);
first.api.installFormDraft(first.node("entry-login-form"));
first.node("entry-username").value = "mobile-user";
first.node("entry-password").value = "test-only-draft-password";
first.node("entry-remember").checked = false;
first.node("entry-password").dispatchEvent(new first.window.Event("input", { bubbles: true }));
const refreshed = environment(stored);
const refreshedDraft = refreshed.api.installFormDraft(refreshed.node("entry-login-form"));
assert.equal(refreshed.node("entry-username").value, "mobile-user");
assert.equal(refreshed.node("entry-password").value, "test-only-draft-password");
assert.equal(refreshed.node("entry-remember").checked, false);
refreshed.node("entry-remember").checked = true;
refreshed.node("entry-remember").dispatchEvent(new refreshed.window.Event("change", { bubbles: true }));
const checkedRefresh = environment(stored);
checkedRefresh.api.installFormDraft(checkedRefresh.node("entry-login-form"));
assert.equal(checkedRefresh.node("entry-remember").checked, true);
refreshedDraft.clearPassword();
assert.equal(refreshed.node("entry-password").value, "");
assert.equal(JSON.parse(stored.get(draftKey)).password, "");

const autofilled = environment(new Map([[draftKey, JSON.stringify({ version: 1, username: "draft-user", password: "draft-secret", remember: false, expiresAt: Date.now() + 60_000 })]]));
autofilled.node("entry-username").value = "password-manager-user";
autofilled.node("entry-password").value = "password-manager-secret";
autofilled.api.installFormDraft(autofilled.node("entry-login-form"));
assert.equal(autofilled.node("entry-username").value, "password-manager-user");
assert.equal(autofilled.node("entry-password").value, "password-manager-secret");
const expired = environment(new Map([[draftKey, JSON.stringify({ version: 1, username: "old-user", password: "expired-secret", expiresAt: Date.now() - 1 })]]));
expired.api.installFormDraft(expired.node("entry-login-form"));
assert.equal(expired.node("entry-password").value, "");
assert.equal(expired.stored.has(draftKey), false);
const blocked = environment();
blocked.context.sessionStorage = { getItem() { throw new Error("Storage blocked"); }, setItem() { throw new Error("Storage blocked"); } };
assert.doesNotThrow(() => blocked.api.installFormDraft(blocked.node("entry-login-form")).clearPassword());
assert.equal(first.node("entry-login-form").getAttribute("method"), "post");

// Verification does not wait for the independent, unresolved session request.
const startup = index.slice(index.lastIndexOf('if (sessionStorage.getItem("xyj_runtime_blocked")'));
const startupBody = startup.slice(0, startup.indexOf("</script>"));
const order = [];
vm.runInNewContext(startupBody, { sessionStorage: { getItem: () => null },
  initializeGuestProtection: () => { order.push("verification"); return Promise.resolve(); },
  initializeEntryPhotoBackground: () => order.push("background"),
  boot: () => { order.push("session"); return new Promise(() => {}); },
});
assert.deepEqual(order, ["verification", "background", "session"]);

const enabled = { enabled: true, siteKey: "test-site-key", action: "entry_login" };
function challenge(env, loadConfig = async () => enabled) {
  const tokens = [], configs = [], notices = [];
  const control = env.api.createChallenge({ loadConfig, onToken: token => tokens.push(token), onConfig: config => configs.push(config), onNotice: text => notices.push(text) });
  return { control, tokens, configs, notices };
}
function mockTurnstile(env) {
  const widgets = [], removed = [], reset = [];
  env.context.turnstile = { render(host, options) { widgets.push({ host, options }); return `widget-${widgets.length}`; },
    remove: id => removed.push(id), reset: id => reset.push(id),
  };
  return { widgets, removed, reset };
}

const valid = environment();
const widgets = mockTurnstile(valid);
Object.defineProperty(valid.node("guest-turnstile"), "clientWidth", { value: 260 });
let configCalls = 0;
const verified = challenge(valid, async () => { configCalls++; return enabled; });
const one = verified.control.initialize(), two = verified.control.initialize();
assert.equal(one, two);
await one;
assert.equal(configCalls, 1);
assert.equal(widgets.widgets.length, 1);
assert.equal(widgets.widgets[0].options.size, "compact");
valid.fire(12_000);
assert.equal(valid.node("entry-verification-retry").hidden, false);
widgets.widgets[0].options.callback("valid-token");
assert.equal(verified.tokens.at(-1), "valid-token");
assert.equal(valid.node("entry-verification-retry").hidden, true);
widgets.widgets[0].options["expired-callback"]();
assert.equal(verified.tokens.at(-1), "");
assert.equal(valid.node("entry-verification-retry").hidden, false);
await verified.control.initialize({ reload: true });
widgets.widgets[0].options.callback("stale-token");
assert.equal(verified.tokens.at(-1), "", "an earlier widget cannot restore an invalidated token");
widgets.widgets[1].options.callback("fresh-token");
assert.equal(verified.tokens.at(-1), "fresh-token");
verified.control.reset();
assert.equal(verified.tokens.at(-1), "");
assert.deepEqual(widgets.reset, ["widget-2"]);
assert.deepEqual(widgets.removed, ["widget-1"]);

// A slow or failed third-party script can be retried without clearing form data.
const loading = environment();
loading.api.installFormDraft(loading.node("entry-login-form"));
loading.node("entry-password").value = "keep-during-retry";
loading.node("entry-password").dispatchEvent(new loading.window.Event("input", { bubbles: true }));
const loader = challenge(loading);
let pending = loader.control.initialize();
await flush();
assert.ok(loading.node("xyj-turnstile-script"));
const networkFailure = assert.rejects(pending, /组件加载失败/);
loading.node("xyj-turnstile-script").onerror();
await networkFailure;
assert.equal(loading.node("xyj-turnstile-script"), null);
assert.equal(loading.node("entry-verification-retry").hidden, false);
pending = loader.control.initialize({ reload: true });
await flush();
const timeout = assert.rejects(pending, /加载较慢/);
loading.fire(15_000);
await timeout;
pending = loader.control.initialize({ reload: true });
await flush();
const loadedWidgets = mockTurnstile(loading);
loading.node("xyj-turnstile-script").onload();
await pending;
assert.equal(loadedWidgets.widgets.length, 1);
loading.node("entry-verification-retry").click();
await flush();
assert.equal(loadedWidgets.widgets.length, 2);
assert.equal(loading.node("entry-password").value, "keep-during-retry");
assert.equal(JSON.parse(loading.stored.get(draftKey)).password, "keep-during-retry");

const configStall = environment();
const stalled = challenge(configStall, signal => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
pending = stalled.control.initialize();
const configTimeout = assert.rejects(pending, /加载较慢/);
configStall.fire(12_000);
await configTimeout;
assert.equal(configStall.node("entry-verification-retry").hidden, false);
assert.equal(configStall.node("xyj-turnstile-script"), null);

const configRace = environment();
const oldConfig = deferred(); let attempts = 0;
const racing = challenge(configRace, () => ++attempts === 1 ? oldConfig.promise : Promise.resolve({ enabled: false }));
const older = racing.control.initialize();
await racing.control.initialize({ reload: true });
oldConfig.resolve(enabled);
await older;
assert.equal(racing.configs.length, 1);
assert.equal(racing.configs[0].enabled, false);
assert.equal(configRace.node("entry-verification").hidden, true);
assert.equal(configRace.node("xyj-turnstile-script"), null);

// Platform hints change default typography while the existing theme still initializes.
for (const [agent, platform, expected] of [
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "iPhone", "apple"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "MacIntel", "apple"],
  ["Mozilla/5.0 (Phone;OpenHarmony 6.0) ArkWeb/6.0.0.42 Mobile", "", "harmony"],
  ["Mozilla/5.0 HarmonyOS HuaweiBrowser/15", "", "harmony"],
  ["Mozilla/5.0 (Linux; Android 12; HUAWEI P50)", "", "harmony"],
  ["Mozilla/5.0 (Linux; Android 14; Pixel 8)", "Linux armv8", "default"],
  ["Mozilla/5.0 (Windows NT 10.0)", "Win32", "default"],
]) {
  const env = environment(new Map(), { userAgent: agent, platform });
  vm.runInContext(themeSource, env.context);
  assert.equal(env.window.document.documentElement.dataset.platformFont, expected);
  assert.equal(env.window.document.documentElement.dataset.theme, "light");
}
console.log("mobile entry draft, early verification, timeout/retry, stale tokens and native-font selection regression passed");
