import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import {
  RateLimitState,
  requestLimitScope,
  waitLabel,
} from "../app/rate-limit-state.ts";

test("known limits share deadlines by backend bucket and never shorten or extend rejected local attempts", () => {
  let now = 10_000;
  const state = new RateLimitState(() => now, "first-account");
  state.observe(
    "server-mutation",
    new Response(null, { status: 429, headers: { "Retry-After": "65" } }),
  );
  assert.equal(state.seconds("server-mutation"), 65);
  assert.equal(state.seconds("soundboard"), 0);
  assert.equal(waitLabel(65), "1m 5s");
  now += 1001;
  assert.equal(state.seconds("server-mutation"), 64);
  state.observe("server-mutation", new Response(null, { status: 200 }));
  state.wait("server-mutation", 1000);
  assert.equal(state.seconds("server-mutation"), 64);
  now += 64_000;
  assert.equal(state.seconds("server-mutation"), 0);
  assert.equal(state.activeSnapshot(), "[]");
});
test("Retry-After supports HTTP dates, malformed values recover and account stores are isolated", () => {
  let now = Date.parse("2026-11-16T12:00:00Z");
  const first = new RateLimitState(() => now, "one");
  const second = new RateLimitState(() => now, "two");
  first.observe(
    "avatar",
    new Response(null, {
      status: 429,
      headers: { "Retry-After": "Mon, 16 Nov 2026 12:00:12 GMT" },
    }),
  );
  assert.equal(first.seconds("avatar"), 12);
  assert.equal(second.seconds("avatar"), 0);
  first.observe(
    "reaction",
    new Response(null, { status: 429, headers: { "Retry-After": "invalid" } }),
  );
  assert.equal(first.seconds("reaction"), 1);
  now += 1001;
  assert.equal(first.seconds("reaction"), 0);
  first.dispose();
  assert.equal(first.seconds("avatar"), 0);
});
test("request scopes match backend methods, shared budgets and unlimited reads/leave", () => {
  const scope = requestLimitScope;
  for (const id of ["one", "two"]) {
    assert.equal(
      scope(`/api/servers/${id}/members`, "PATCH"),
      "server-mutation",
    );
    assert.equal(
      scope(`/api/servers/${id}/members`, "POST"),
      "server-invitations",
    );
    assert.equal(scope(`/api/servers/${id}/members`, "DELETE"), null);
    assert.equal(scope(`/api/servers/${id}/members`, "GET"), null);
    assert.equal(
      scope(`/api/servers/${id}/soundboard/play`, "post"),
      "soundboard-play",
    );
  }
  assert.equal(scope("/api/channels/one/messages", "POST"), "message");
  assert.equal(scope("/api/direct-messages/two", "POST"), "message");
  assert.equal(scope("/api/direct-messages/two/message", "PATCH"), "message");
  assert.equal(
    scope("/api/direct-messages/two/message", "DELETE"),
    "direct-delete",
  );
  assert.equal(scope("/api/servers", "DELETE", '{"action":"leave"}'), null);
  assert.equal(scope("/api/servers", "PATCH", '{"name":"Rename"}'), null);
  assert.equal(scope("/api/admin", "GET"), null);
  assert.equal(scope("/api/admin", "PATCH"), "admin-mutation");
  assert.equal(scope("/api/demo-accounts", "POST"), "admin-mutation");
});

test("sign-in stays on the page for a failed handoff so its countdown remains visible", async () => {
  const source = await readFile(
    new URL("../app/login/page.tsx", import.meta.url),
    "utf8",
  );
  for (const success of [false, true]) {
    const exports = {},
      requests = [],
      navigation = [],
      states = [];
    const element = (type, props) => ({ type, props });
    const dependencies = {
      "react/jsx-runtime": { jsx: element, jsxs: element },
      react: {
        useState: (initial) => [initial, (value) => states.push(value)],
      },
      "next-auth/react": {
        signIn: async (provider, options) => {
          requests.push({ provider, options });
          return {
            ok: success,
            url: success ? "https://accounts.example.invalid/oauth" : null,
          };
        },
      },
      "../rate-limit-controls": { RateLimitButton: "limited-button" },
      "../legal-links": { LegalLinks: "legal-links" },
    };
    vm.runInNewContext(
      ts.transpile(source, {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      }),
      {
        exports,
        require: (name) => {
          assert.ok(name in dependencies, name);
          return dependencies[name];
        },
        window: { location: { assign: (url) => navigation.push(url) } },
      },
    );
    const nodes = [];
    function visit(node) {
      if (!node || typeof node !== "object") return;
      nodes.push(node);
      for (const child of [node.props?.children].flat(Infinity)) visit(child);
    }
    visit(exports.default());
    nodes.find((node) => node.type === "limited-button").props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests[0].options.redirect, false);
    assert.equal(navigation.length, success ? 1 : 0);
    if (!success)
      assert.ok(states.includes("Sign-in could not start. Please try again."));
  }
});
