import { and, eq, lt } from "drizzle-orm";
import { db } from "../db";
import { serverActivity, serverMembers } from "../db/schema";
import type { ActivityAction } from "../app/server-activity-types";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
// Explicit fields only; never accept request bodies, messages or invite tokens.
export type ActivityDetails = {
  name?: string;
  previousName?: string;
  role?: string;
  previousRole?: string;
  channelId?: string;
  destinationId?: string;
  targetChannelId?: string;
  placement?: string;
  enabled?: boolean;
  afkChannelId?: string | null;
  previousAfkChannelId?: string | null;
  type?: string;
};
const allowedDetails = new Set([
  "name",
  "previousName",
  "role",
  "previousRole",
  "channelId",
  "destinationId",
  "targetChannelId",
  "placement",
  "enabled",
  "afkChannelId",
  "previousAfkChannelId",
  "type",
]);
export function activityDetails(details: ActivityDetails = {}) {
  return Object.fromEntries(
    Object.entries(details)
      .filter(
        ([key, value]) =>
          allowedDetails.has(key) &&
          (value === null ||
            typeof value === "string" ||
            typeof value === "boolean"),
      )
      .map(([key, value]) => [
        key,
        typeof value === "string" ? value.slice(0, 120) : value,
      ]),
  );
}
export async function recordServerActivity(
  tx: Transaction,
  serverId: string,
  actorId: string,
  action: ActivityAction,
  targetType: "server" | "channel" | "user" | "sound",
  targetId: string,
  details: ActivityDetails = {},
) {
  await tx
    .delete(serverActivity)
    .where(
      and(
        eq(serverActivity.serverId, serverId),
        lt(serverActivity.createdAt, new Date(Date.now() - 90 * 86400_000)),
      ),
    );
  await tx.insert(serverActivity).values({
    serverId,
    actorId,
    action,
    targetType,
    targetId,
    details: activityDetails(details),
  });
}

export async function recordDemoAccessChanges(
  tx: Transaction,
  actorId: string,
  userId: string,
  nextServerIds: string[],
) {
  const previous = await tx
    .select({ serverId: serverMembers.serverId })
    .from(serverMembers)
    .where(eq(serverMembers.userId, userId));
  for (const { serverId } of previous) {
    if (!nextServerIds.includes(serverId))
      await recordServerActivity(
        tx,
        serverId,
        actorId,
        "member.demo-remove",
        "user",
        userId,
      );
  }
  for (const serverId of nextServerIds) {
    if (!previous.some((row) => row.serverId === serverId))
      await recordServerActivity(
        tx,
        serverId,
        actorId,
        "member.demo-add",
        "user",
        userId,
      );
  }
}
