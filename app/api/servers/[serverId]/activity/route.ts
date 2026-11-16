import { sql } from "drizzle-orm";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { checkRateLimit } from "../../../../../server/rate-limit";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export async function GET(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  try {
    return await readActivity(request, { params });
  } catch (error) {
    // Do not return query text, credentials, or driver errors to the browser.
    const failure = error as { code?: string; cause?: { code?: string } };
    const code = failure?.cause?.code ?? failure?.code;
    return Response.json(
      {
        error:
          code === "42P01"
            ? "Activity log is unavailable until the database update is applied."
            : "Activity could not be loaded. Please try again shortly.",
      },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

async function readActivity(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;
  if (!uuid.test(serverId))
    return Response.json({ error: "Invalid server" }, { status: 400 });
  const limit = checkRateLimit(`server-activity:${session.user.id}`, {
    limit: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed)
    return Response.json(
      { error: "Too many requests. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  const url = new URL(request.url);
  const before = url.searchParams.get("before");
  const id = url.searchParams.get("id");
  if (
    (before || id) &&
    (!before ||
      !id ||
      !uuid.test(id) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(before) ||
      !Number.isFinite(Date.parse(before)))
  )
    return Response.json({ error: "Invalid page cursor" }, { status: 400 });
  const result = await db.transaction(async (tx) => {
    // Parent-first order also coordinates with ownership and server deletion.
    const parent = await tx.execute(
      sql`SELECT id FROM servers WHERE id=${serverId} FOR SHARE`,
    );
    if (!parent.rows.length) return null;
    // Hold membership against demotion/removal until this page has been read.
    const access = await tx.execute(
      sql`SELECT role FROM server_members WHERE server_id=${serverId} AND user_id=${session.user.id} FOR SHARE`,
    );
    if (!access.rows.some((row) => row.role === "owner" || row.role === "mod"))
      return null;
    await tx.execute(
      sql`DELETE FROM server_activity WHERE server_id=${serverId} AND created_at < now() - interval '90 days'`,
    );
    return tx.execute(sql`
      SELECT a.id, a.actor_id AS "actorId", actor.name AS "actorName", actor.image AS "actorImage",
        a.action, a.target_type AS "targetType", a.target_id AS "targetId",
        CASE WHEN a.target_type='user' THEN target.name
          ELSE COALESCE(c.name, s.name, srv.name, a.details->>'name') END AS "targetName",
        CASE WHEN a.target_type='user' THEN target.image END AS "targetImage",
        a.details,
        (SELECT COALESCE(jsonb_object_agg(ref.id::text,ref.name), '{}'::jsonb) FROM channels ref
          WHERE ref.server_id=a.server_id AND ref.id::text IN (a.details->>'channelId',a.details->>'destinationId',a.details->>'targetChannelId',a.details->>'afkChannelId',a.details->>'previousAfkChannelId')) AS "references",
        a.created_at AS "createdAt",
        to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt"
      FROM server_activity a LEFT JOIN users actor ON actor.id=a.actor_id
        LEFT JOIN users target ON a.target_type='user' AND target.id=a.target_id
        LEFT JOIN channels c ON a.target_type='channel' AND c.id=a.target_id
        LEFT JOIN server_sounds s ON a.target_type='sound' AND s.id=a.target_id
        LEFT JOIN servers srv ON a.target_type='server' AND srv.id=a.target_id
      WHERE a.server_id=${serverId} AND a.created_at >= now() - interval '90 days'
        ${before && id ? sql`AND (a.created_at,a.id) < (${before}::timestamptz,${id}::uuid)` : sql``}
      ORDER BY a.created_at DESC,a.id DESC LIMIT 51
    `);
  });
  if (!result) return Response.json({ error: "Forbidden" }, { status: 403 });
  const entries = result.rows.slice(0, 50);
  const last = entries.at(-1);
  return Response.json(
    {
      entries,
      next:
        result.rows.length > 50 && last
          ? { before: last.cursorAt, id: last.id }
          : null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
