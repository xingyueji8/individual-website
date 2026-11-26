// Temporary release comparison. Ordinary traffic continues to use the previously verified Worker.
import previous from "./worker.js";
import refactor from "./server/worker.js";
import { ensureSchema } from "./server/db/initialize.js";
import { requestGateResponse } from "./server/http/request.js";

function summarize(error) {
  const text = [error?.message, error?.cause?.message].filter(Boolean).join(" ");
  const undefinedName = text.match(/\b([a-zA-Z_$][a-zA-Z0-9_$]*) is not defined\b/)?.[1];
  if (error?.name === "ReferenceError" && undefinedName) return "reference:" + undefinedName;
  if (/subrequest|limit|quota|too many/i.test(text)) return "limit";
  if (/connection|unavailable|timed out/i.test(text)) return "connection";
  if (/no such (column|table)|already exists|duplicate column/i.test(text)) return "schema";
  if (/constraint|foreign key/i.test(text)) return "constraint";
  if (/syntax|incomplete input/i.test(text)) return "sql-syntax";
  if (/D1_ERROR|D1_EXEC_ERROR/i.test(text)) return "d1-error";
  if (error?.name === "TypeError") return "type";
  return "other";
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/api/health" ||
        request.headers.get("X-Xyj-Release-Check") !== "5f0d34b") {
      return previous.fetch(request, env, ctx);
    }
    const gate = requestGateResponse(url, env);
    if (gate) return gate;
    let phase = "connection";
    try {
      if (!(await env.DB.prepare("SELECT 1 AS ok").first())?.ok) {
        return Response.json({ candidate: "no-database" }, { status: 503 });
      }
      phase = "startup";
      await ensureSchema(env);
      phase = "health";
      const outcome = await refactor.fetch(request, env, ctx);
      return Response.json({ candidate: outcome.ok ? "healthy" : "unhealthy", status: outcome.status }, {
        status: outcome.status, headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      return Response.json({ candidate: summarize(error), phase }, {
        status: 503, headers: { "Cache-Control": "no-store" },
      });
    }
  },
};

