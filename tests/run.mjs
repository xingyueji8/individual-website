import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildWeb } from "../scripts/build-web.mjs";
import { suites } from "./suites.mjs";

const selected = process.argv.slice(2);
const groups = selected.length ? selected : Object.keys(suites);
for (const group of groups) {
  if (!Object.hasOwn(suites, group)) throw new Error(`未知测试分组 ${group}。可用：${Object.keys(suites).join(", ")}`);
}

await buildWeb(); // Test the same HTML and assets Wrangler deploys, built once.
for (const group of groups) {
  for (const test of suites[group]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(test, import.meta.url))], { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
