import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import "dotenv/config";
import pg from "pg";
import * as orm from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.ts";
import * as activityTypes from "../app/server-activity-types.ts";
import * as uploads from "../server/sound-upload.ts";
import { soundWave } from "./sound-wave.ts";

async function load(path, dependencies) {
  const exports = {};
  vm.runInNewContext(
    ts.transpile(await readFile(new URL(path, import.meta.url), "utf8"), {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      Buffer,
      require: (name) => {
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
      URL,
      Request,
      Response,
    },
  );
  return exports;
}
test("server activity enforces scoped roles, precise pagination, retention, current avatars, cascade and mutation rollback in PostgreSQL", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    if (
      !(await client.query("SELECT to_regclass('server_activity') AS name"))
        .rows[0].name
    )
      await client.query(
        await readFile(
          new URL("../db/migrations/0034_server_activity.sql", import.meta.url),
          "utf8",
        ),
      );
    const base = drizzle(client, { schema });
    let serial = 0;
    const db = new Proxy(base, {
      get(target, key) {
        if (key === "transaction")
          return async (run) => {
            const savepoint = `activity_${++serial}`;
            await client.query(`SAVEPOINT ${savepoint}`);
            try {
              const result = await run(base);
              await client.query(`RELEASE SAVEPOINT ${savepoint}`);
              return result;
            } catch (error) {
              await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
              throw error;
            }
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const [owner, mod, member, outsider, demo, serverId, otherServer] =
      Array.from({ length: 7 }, () => randomUUID());
    await base.insert(schema.users).values([
      { id: owner, name: "Owner", image: "https://example.invalid/owner.png" },
      { id: mod, name: "Moderator" },
      { id: member, name: "Member" },
      { id: outsider, name: "Outsider" },
      { id: demo, name: "Demo", role: "demo" },
    ]);
    await base.insert(schema.servers).values([
      { id: serverId, name: "Audit test", createdBy: owner },
      { id: otherServer, name: "Other", createdBy: outsider },
    ]);
    await base.insert(schema.serverMembers).values([
      { serverId, userId: owner, role: "owner" },
      { serverId, userId: mod, role: "mod" },
      { serverId, userId: member },
      { serverId: otherServer, userId: outsider, role: "owner" },
    ]);
    const activity = await load("../server/server-activity.ts", {
      "drizzle-orm": orm,
      "../db/schema": schema,
    });
    const [channel] = await base
      .insert(schema.channels)
      .values({ serverId, name: "Before", type: "text" })
      .returning();
    let actorId = owner;
    const route = await load(
      "../app/api/servers/[serverId]/activity/route.ts",
      {
        "drizzle-orm": orm,
        "../../../../../auth": {
          auth: async () => ({ user: { id: actorId } }),
        },
        "../../../../../db": { db },
        "../../../../../server/rate-limit": {
          checkRateLimit: () => ({ allowed: true }),
        },
      },
    );
    const read = (id = serverId, cursor = null) =>
      route.GET(
        new Request(
          `https://local/activity${cursor ? `?${new URLSearchParams(cursor)}` : ""}`,
        ),
        { params: Promise.resolve({ serverId: id }) },
      );
    for (actorId of [member, outsider])
      assert.equal((await read()).status, 403);
    actorId = owner;
    assert.equal((await read(otherServer)).status, 403);
    // Fractional microseconds must survive the cursor; JS Date would truncate them.
    await client.query(
      "INSERT INTO server_activity(server_id,actor_id,action,target_type,target_id,created_at) SELECT $1,$2,'member.invite','user',$3,now() - interval '1 second' + n * interval '1 microsecond' FROM generate_series(1,53) n",
      [serverId, owner, demo],
    );
    await client.query(
      "INSERT INTO server_activity(server_id,actor_id,action,target_type,target_id,created_at) VALUES ($1,$2,'member.invite','user',$3,now() - interval '91 days')",
      [serverId, owner, demo],
    );
    const first = await (await read()).json();
    assert.equal(first.entries.length, 50);
    assert.equal(
      first.entries[0].actorImage,
      "https://example.invalid/owner.png",
    );
    assert.match(first.next.before, /\.\d{6}Z$/);
    const second = await (await read(serverId, first.next)).json();
    assert.equal(second.entries.length, 3);
    assert.equal(second.next, null);
    assert.equal(
      new Set([...first.entries, ...second.entries].map((row) => row.id)).size,
      53,
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*) AS n FROM server_activity WHERE server_id=$1",
          [serverId],
        )
      ).rows[0].n,
      "53",
    );
    actorId = mod;
    assert.equal((await read()).status, 200);
    await base.delete(schema.users).where(orm.eq(schema.users.id, demo));
    assert.equal((await (await read()).json()).entries[0].targetName, null);
    actorId = owner;
    const dependencies = {
      "drizzle-orm": orm,
      "next/server": { NextResponse: { json: Response.json } },
      "../../../../../auth": { auth: async () => ({ user: { id: owner } }) },
      "../../../../../db": { db },
      "../../../../../db/schema": schema,
      "../../../../../server/server-activity": activity,
      "../../../../../server/rate-limit": {
        checkRateLimit: () => ({ allowed: true }),
        rateLimits: {},
      },
      "../../../../../server/notify-server": { notifyServer: async () => {} },
      "../../../../../server/remove-channel-media": {
        removeChannelMedia: async () => {},
      },
    };
    const change = async (auditDependency, name) => {
      const channels = await load(
        "../app/api/servers/[serverId]/channels/route.ts",
        {
          ...dependencies,
          "../../../../../server/server-activity": auditDependency,
        },
      );
      return channels.PATCH(
        new Request("https://local/channels", {
          method: "PATCH",
          body: JSON.stringify({ channelId: channel.id, name }),
        }),
        { params: Promise.resolve({ serverId }) },
      );
    };
    assert.equal((await change(activity, "After")).status, 200);
    const latest = (await (await read()).json()).entries[0];
    assert.equal(latest.action, "channel.rename");
    assert.deepEqual(latest.details, { name: "After", previousName: "Before" });
    await assert.rejects(
      change(
        {
          recordServerActivity: async () => {
            throw new Error("audit unavailable");
          },
        },
        "Must roll back",
      ),
      /audit unavailable/,
    );
    assert.equal(
      (
        await base
          .select()
          .from(schema.channels)
          .where(orm.eq(schema.channels.id, channel.id))
      )[0].name,
      "After",
    );
    const audit = await load("../server/admin-audit.ts", {
      "../db/schema": schema,
      "../app/server-activity-types": activityTypes,
      "./server-activity": activity,
    });
    await db.transaction((tx) =>
      audit.auditAdmin(
        tx,
        owner,
        "server.soundboard",
        "server",
        serverId,
        { serverId },
        { enabled: false },
      ),
    );
    assert.equal(
      (await (await read()).json()).entries.find(
        (row) => row.action === "server.soundboard",
      ).details.enabled,
      false,
    );
    const sounds = await load(
      "../app/api/servers/[serverId]/soundboard/route.ts",
      {
        ...dependencies,
        "../../../../../auth": {
          auth: async () => ({ user: { id: actorId } }),
        },
        "../../../../../server/sound-upload": uploads,
        "../../../../../server/notify-user": { notifyUser: async () => {} },
      },
    );
    actorId = mod;
    const added = await sounds.POST(
      new Request("https://local/sounds?name=Test", {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: soundWave("chime-v1"),
      }),
      { params: Promise.resolve({ serverId }) },
    );
    assert.equal(added.status, 201);
    const clip = await added.json();
    assert.equal(
      (await (await read()).json()).entries.find(
        (row) => row.action === "sound.create",
      ).actorId,
      mod,
    );
    const removeSound = () =>
      sounds.DELETE(
        new Request(`https://local/sounds?clip=${clip.id}`, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ serverId }) },
      );
    assert.equal((await removeSound()).status, 403);
    actorId = owner;
    assert.equal((await removeSound()).status, 200);
    assert.equal(
      (await (await read()).json()).entries.find(
        (row) => row.action === "sound.delete",
      ).targetId,
      clip.id,
    );
    await base
      .delete(schema.servers)
      .where(orm.eq(schema.servers.id, serverId));
    assert.equal(
      (
        await client.query(
          "SELECT count(*) AS n FROM server_activity WHERE server_id=$1",
          [serverId],
        )
      ).rows[0].n,
      "0",
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
