export const activityLabels = {
  "server.create": "Created the server",
  "server.rename": "Renamed the server",
  "server.afk": "Changed the AFK channel",
  "server.picture": "Changed the server picture",
  "server.picture-remove": "Removed the server picture",
  "server.soundboard": "Changed soundboard cooldown",
  "server.ownership": "Transferred server ownership",
  "channel.create": "Created a channel",
  "channel.rename": "Renamed a channel",
  "channel.delete": "Deleted a channel",
  "channel.order": "Reordered a channel",
  "member.role": "Changed a member’s role",
  "member.kick": "Kicked a member from the server",
  "member.invite": "Sent a server invitation",
  "member.invite-cancel": "Cancelled a server invitation",
  "member.demo-add": "Granted demo server access",
  "member.demo-remove": "Removed demo server access",
  "member.account-remove": "Removed an account from the application",
  "sound.create": "Added a sound",
  "sound.delete": "Removed a sound",
  "voice.mute": "Server-muted a member",
  "voice.unmute": "Removed a server mute",
  "voice.deafen": "Server-deafened a member",
  "voice.undeafen": "Removed a server deafen",
  "voice.move": "Delivered a voice move request",
  "voice.kick": "Requested a voice disconnect",
  "message.delete": "Deleted a demo user’s channel message",
  "message.bulk-delete": "Cleared a demo user’s channel messages",
  "message.delete-permanently":
    "Permanently deleted a demo user’s channel message",
} as const;
export type ActivityAction = keyof typeof activityLabels;
export type ActivityEntry = {
  id: string;
  actorId: string;
  actorName: string | null;
  actorImage: string | null;
  action: ActivityAction;
  targetType: string;
  targetId: string;
  targetName: string | null;
  targetImage: string | null;
  details: Record<string, string | boolean | null>;
  references?: Record<string, string>;
  createdAt: string;
};
