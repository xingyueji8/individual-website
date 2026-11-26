import { Miniflare } from "miniflare";

// Every Worker test gets isolated D1/R2 bindings and no production credentials.
export function localWorker(options = {}) {
  return new Miniflare({
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    scriptPath: "src/server/worker.js",
    compatibilityDate: "2026-08-06",
    cf: false, // Do not fetch remote request metadata when running tests.
    d1Databases: ["DB"],
    r2Buckets: ["BUCKET"],
    ...options,
  });
}
