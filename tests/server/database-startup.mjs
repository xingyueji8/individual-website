import assert from "node:assert/strict";
import { localWorker } from "../support/local-worker.mjs";

for (const legacy of [false, true]) {
  const app = localWorker({ scriptPath: "tests/support/startup-with-budget.js", modulesRoot: "." });
  try {
    const db = await app.getD1Database("DB");
    if (legacy) {
      await db.batch([
        db.prepare("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)"),
        db.prepare("INSERT INTO settings VALUES ('site_title','旧版测试站','2026-08-07T00:00:00.000Z')"),
        db.prepare(`CREATE TABLE albums (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, sort_order INTEGER NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )`),
        db.prepare("INSERT INTO albums VALUES ('legacy-album','旧相册','',0,'2026-08-07','2026-08-07')"),
      ]);
    }
    const checked = await app.dispatchFetch("http://localhost/api/health");
    assert.equal(checked.status, 200, await checked.clone().text());
    assert.equal((await checked.json()).ok, true);
    const requests = Number(checked.headers.get("X-Test-D1-Requests"));
    assert.ok(requests > 0 && requests <= 50);
    const config = await app.dispatchFetch("http://localhost/api/guest/config");
    assert.equal(config.status, 200);
    if (legacy) {
      assert.equal((await db.prepare("SELECT value FROM settings WHERE key='site_title'").first()).value, "旧版测试站");
      assert.equal((await db.prepare("SELECT name FROM albums WHERE id='legacy-album'").first()).name, "旧相册");
    }
    console.log(`${legacy ? "Legacy" : "Fresh"} database ready with ${requests} D1 calls`);
  } finally {
    await app.dispose();
  }
}
