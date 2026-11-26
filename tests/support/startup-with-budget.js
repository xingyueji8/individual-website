import worker from "../../src/server/worker.js";

// Count D1 round trips like a Worker deployment. A batch uses one request.
export default {
  async fetch(request, env, ctx) {
    let requests = 0;
    const count = () => {
      if (++requests > 50) throw new Error("D1 request budget exceeded");
    };
    const rawStatements = new WeakMap();
    function wrap(statement) {
      const wrapped = {
        bind: (...args) => wrap(statement.bind(...args)),
        all: () => { count(); return statement.all(); },
        first: (...args) => { count(); return statement.first(...args); },
        run: () => { count(); return statement.run(); },
      };
      rawStatements.set(wrapped, statement);
      return wrapped;
    }
    const DB = {
      prepare: sql => wrap(env.DB.prepare(sql)),
      batch: statements => {
        count();
        return env.DB.batch(statements.map(statement => rawStatements.get(statement)));
      },
    };
    const response = await worker.fetch(request, { ...env, DB }, ctx);
    const headers = new Headers(response.headers);
    headers.set("X-Test-D1-Requests", String(requests));
    return new Response(response.body, { status: response.status, headers });
  },
};
