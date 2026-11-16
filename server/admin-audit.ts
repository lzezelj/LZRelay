import { db } from "../db";
import { adminAuditLog } from "../db/schema";
import {
  activityLabels,
  type ActivityAction,
} from "../app/server-activity-types";
import { recordServerActivity, type ActivityDetails } from "./server-activity";

export type AdminTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
export async function auditAdmin(
  tx: AdminTransaction,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  context: { userId?: string; serverId?: string; channelId?: string } = {},
  details: ActivityDetails = {},
) {
  await tx
    .insert(adminAuditLog)
    .values({ actorId, action, targetType, targetId, ...context });
  // Keep the private admin log independent; mirror only scoped server changes.
  const serverAction =
    action === "server.picture.change"
      ? "server.picture"
      : action === "server.picture.remove"
        ? "server.picture-remove"
        : action;
  if (
    context.serverId &&
    Object.hasOwn(activityLabels, serverAction) &&
    (targetType === "server" || targetType === "channel")
  ) {
    await recordServerActivity(
      tx,
      context.serverId,
      actorId,
      serverAction as ActivityAction,
      action === "server.ownership" && context.userId ? "user" : targetType,
      action === "server.ownership" && context.userId
        ? context.userId
        : targetId,
      details,
    );
  }
  if (context.serverId && action === "demo.create") {
    await recordServerActivity(
      tx,
      context.serverId,
      actorId,
      "member.demo-add",
      "user",
      targetId,
    );
  }
}
