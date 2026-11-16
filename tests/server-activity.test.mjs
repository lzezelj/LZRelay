import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as orm from "drizzle-orm";

async function load(path, dependencies) {
  const exports = {};
  vm.runInNewContext(
    ts.transpile(await readFile(new URL(path, import.meta.url), "utf8"), {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      require: (name) => {
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
      URL,
      Response,
    },
  );
  return exports;
}
test("activity metadata rejects arbitrary content, tokens, emails and oversized values", async () => {
  const { activityDetails } = await load("../server/server-activity.ts", {
    "drizzle-orm": orm,
    "../db/schema": {},
  });
  const details = activityDetails({
    name: "x".repeat(180),
    role: "mod",
    enabled: false,
    afkChannelId: null,
    content: "private message",
    token: "private token",
    email: "private email",
    destinationId: { secret: true },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(details)), {
    name: "x".repeat(120),
    role: "mod",
    enabled: false,
    afkChannelId: null,
  });
});
test("activity endpoint rejects missing sessions, malformed cursors and non-moderators before reading history", async () => {
  const serverId = "11111111-1111-4111-8111-111111111111";
  const userId = "22222222-2222-4222-8222-222222222222";
  let session = null;
  let queries = 0;
  const route = await load("../app/api/servers/[serverId]/activity/route.ts", {
    "drizzle-orm": orm,
    "../../../../../auth": { auth: async () => session },
    "../../../../../db": {
      db: {
        transaction: async (run) =>
          run({
            execute: async () => {
              queries++;
              return { rows: [{ role: "member" }] };
            },
          }),
      },
    },
    "../../../../../server/rate-limit": {
      checkRateLimit: () => ({ allowed: true }),
    },
  });
  const request = (query = "") =>
    route.GET(new Request(`https://local/activity${query}`), {
      params: Promise.resolve({ serverId }),
    });
  assert.equal((await request()).status, 401);
  assert.equal(queries, 0);
  session = { user: { id: userId } };
  assert.equal((await request("?before=bad&id=bad")).status, 400);
  assert.equal(queries, 0);
  assert.equal((await request()).status, 403);
  assert.equal(queries, 2);
});

test("activity database failures return safe JSON, including pending migrations", async () => {
  for (const code of ["42P01", "08006"]) {
    const route = await load(
      "../app/api/servers/[serverId]/activity/route.ts",
      {
        "drizzle-orm": orm,
        "../../../../../auth": {
          auth: async () => ({ user: { id: "actor" } }),
        },
        "../../../../../db": {
          db: {
            transaction: async () => {
              throw { cause: { code }, message: "private connection details" };
            },
          },
        },
        "../../../../../server/rate-limit": {
          checkRateLimit: () => ({ allowed: true }),
        },
      },
    );
    const response = await route.GET(new Request("https://local/activity"), {
      params: Promise.resolve({
        serverId: "11111111-1111-4111-8111-111111111111",
      }),
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const data = await response.json();
    assert.match(
      data.error,
      code === "42P01" ? /database update/ : /try again/,
    );
    assert.ok(!data.error.includes("private"));
  }
});

test("activity rate rejection exposes the actual retry duration without accessing the database", async () => {
  const route = await load("../app/api/servers/[serverId]/activity/route.ts", {
    "drizzle-orm": orm,
    "../../../../../auth": { auth: async () => ({ user: { id: "actor" } }) },
    "../../../../../db": {
      db: {
        transaction: async () =>
          assert.fail("Rate-limited requests must not query activity"),
      },
    },
    "../../../../../server/rate-limit": {
      checkRateLimit: () => ({ allowed: false, retryAfterSeconds: 37 }),
    },
  });
  const response = await route.GET(new Request("https://local/activity"), {
    params: Promise.resolve({
      serverId: "11111111-1111-4111-8111-111111111111",
    }),
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "37");
});
