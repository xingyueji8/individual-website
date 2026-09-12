import assert from "node:assert/strict";
import {
  parseAgentPlan, searchAgentResources, issueAgentActions, consumeAgentAction,
} from "../src/site-agent.mjs";

assert.deepEqual(parseAgentPlan('{"action":"chat"}'), { action: "chat" });
assert.deepEqual(parseAgentPlan('```json\n{"action":"search","kind":"media","query":" 月亮 "}\n```'),
  { action: "search", kind: "media", query: "月亮" });
assert.throws(() => parseAgentPlan('{"action":"download","kind":"media","query":"x"}'));
assert.throws(() => parseAgentPlan('{"action":"search","kind":"sql","query":"x"}'));

const searchable = {
  content: [{ id: "article-1", name: "月亮文章" }, { id: "hidden", name: "秘密文章" }],
  media: [{ id: "photo-1", name: "月亮照片", filename: "moon.jpg" }],
  asset: [{ id: "file-1", name: "月亮资料", filename: "moon.pdf", size_bytes: 2048 }],
};
const searchDb = {
  prepare(sql) {
    const kind = sql.includes("FROM content") ? "content" : sql.includes("FROM media") ? "media" : "asset";
    return { bind() { return { async all() { return { results: searchable[kind] }; } }; } };
  },
};
const records = new Map([
  ["content:article-1", { targetKind: "content", id: "article-1" }],
  ["content:hidden", { targetKind: "content", id: "hidden" }],
  ["media:photo-1", { targetKind: "media", id: "photo-1" }],
  ["asset:file-1", { targetKind: "asset", id: "file-1" }],
]);
const security = {
  records,
  principal: "session-a",
  canView(kind, id) { return id !== "hidden"; },
  blockedLocks(kind, id) { return id === "photo-1" ? [{ kind, id }] : []; },
  canDownload(kind, id) { return id !== "photo-1"; },
  requireView() {},
};
const found = await searchAgentResources({ DB: searchDb }, security,
  { action: "search", kind: "all", query: "月亮" });
assert.deepEqual(found.items.map(item => item.id), ["article-1", "photo-1", "file-1"]);
assert.equal(found.items.find(item => item.id === "photo-1").locked, true);
assert.equal(found.items.find(item => item.id === "photo-1").canDownload, false);
assert.equal(found.items.find(item => item.id === "file-1").size, 2048);

const inserted = [];
const actionEnv = {
  DB: {
    prepare(sql) {
      return {
        bind(...values) {
          if (sql.startsWith("INSERT")) return { sql, values };
          return {
            async first() {
              if (sql.startsWith("SELECT")) return {
                token_hash: "hashed", principal: "session-a", kind: "asset",
                target_id: "file-1", expires_at: Date.now() + 10_000,
              };
              if (sql.startsWith("DELETE")) return { target_id: "file-1" };
              return null;
            },
          };
        },
      };
    },
    async batch(statements) { inserted.push(...statements); },
  },
};
const items = [
  { kind: "asset", id: "file-1", canDownload: true, locked: false },
  { kind: "media", id: "photo-1", canDownload: false, locked: false },
];
await issueAgentActions(actionEnv, security, items, {
  token: () => "a".repeat(43), hash: async value => `hash:${value}`,
});
assert.equal(inserted.length, 1);
assert.equal(items[0].confirmationToken.length, 43);
assert.equal(items[1].confirmationToken, undefined);

const consumed = await consumeAgentAction(actionEnv, security,
  { token: "a".repeat(43), confirm: true },
  { hash: async () => "hashed", error: (status, message) => Object.assign(new Error(message), { status }) });
assert.deepEqual(consumed, { kind: "asset", id: "file-1", action: "download" });
await assert.rejects(() => consumeAgentAction(actionEnv, security,
  { token: "a".repeat(43) },
  { hash: async () => "hashed", error: (status, message) => Object.assign(new Error(message), { status }) }),
  error => error.status === 400);

console.log("site agent backend tests passed");
