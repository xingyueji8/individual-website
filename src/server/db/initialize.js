/** Worker 首次调用 D1 的初始化顺序；同一实例的并发共享一个 Promise。 */
import { initializeShares } from "../content/share-links.js";
import { HttpError } from "../http/responses.js";
import { nowIso } from "../shared/values.js";
import { migrateLegacyData } from "./legacy-data.js";
import { cleanupHistoricalRecords } from "./retention.js";
import { seedSiteSettings } from "./site-defaults.js";
import { prepareStructure } from "./structure.js";

let schemaReady = false;
let schemaPromise = null;

async function initializeSchema(env) {
  if (schemaReady) return;
  if (!env.DB) throw new HttpError(503, "D1 数据库尚未绑定");

  await prepareStructure(env);
  await cleanupHistoricalRecords(env);

  const timestamp = nowIso();
  await seedSiteSettings(env, timestamp);
  await migrateLegacyData(env, timestamp);
  await initializeShares(env);
  schemaReady = true;
}

/* 同一 Worker 实例的首批并发请求共用一个初始化 Promise，避免重复 ALTER TABLE。 */
export async function ensureSchema(env) {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = initializeSchema(env).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}
