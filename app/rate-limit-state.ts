export type LimitScope =
  | "login"
  | "message"
  | "direct-delete"
  | "server-mutation"
  | "server-delete"
  | "server-invitations"
  | "server-invitation-action"
  | "admin-mutation"
  | "reaction"
  | "avatar"
  | "server-picture"
  | "soundboard"
  | "soundboard-play"
  | "message-search"
  | "server-order"
  | "channel-order"
  | "notification-settings"
  | "notification-reads"
  | "voice-move"
  | "voice-moderation"
  | "server-activity"
  | "signaling-token"
  | "livekit-token";

export function requestLimitScope(
  path: string,
  method = "GET",
  body?: unknown,
): LimitScope | null {
  method = method.toUpperCase();
  const write = method.toUpperCase() !== "GET";
  if (/^\/api\/auth\/(signin|callback)\//.test(path)) return "login";
  if (
    (path === "/api/admin" && write) ||
    (path === "/api/admin/server-picture" && write) ||
    (path === "/api/demo-accounts" && write)
  )
    return "admin-mutation";
  if (path === "/api/signaling-token") return "signaling-token";
  if (/^\/api\/channels\/[^/]+\/livekit-token$/.test(path))
    return "livekit-token";
  if (path === "/api/message-search") return "message-search";
  if (path === "/api/message-reactions" && write) return "reaction";
  if (path === "/api/notifications/read" && write) return "notification-reads";
  if (path === "/api/notifications" && write) return "notification-settings";
  if (path === "/api/users/me/avatar" && write) return "avatar";
  if (path === "/api/server-invitations" && write)
    return "server-invitation-action";
  if (/^\/api\/direct-messages\/[^/]+\/[^/]+$/.test(path))
    return method === "DELETE"
      ? "direct-delete"
      : method === "PATCH"
        ? "message"
        : null;
  if (
    /^\/api\/(channels\/[^/]+\/messages|direct-messages\/[^/]+)$/.test(path) &&
    write
  )
    return "message";
  if (/^\/api\/messages\/[^/]+$/.test(path) && method === "PATCH")
    return "message";
  if (path === "/api/servers/order" && write) return "server-order";
  if (path === "/api/servers") {
    if (method === "POST") return "server-mutation";
    let data: { action?: string; name?: string } = {};
    try {
      data = typeof body === "string" ? JSON.parse(body) : {};
    } catch {
      /* The API owns validation. */
    }
    if (method === "DELETE")
      return data.action === "leave" ? null : "server-delete";
    if (method === "PATCH" && !data.name) return "server-mutation";
  }
  const part = path.match(/^\/api\/servers\/[^/]+\/(.+)$/)?.[1];
  if (part === "activity") return "server-activity";
  if (!write) return null;
  if (part === "members")
    return method === "POST"
      ? "server-invitations"
      : method === "PATCH"
        ? "server-mutation"
        : null;
  if (
    (part === "channels" && method !== "PATCH") ||
    part === "ownership" ||
    part === "join-sound"
  )
    return "server-mutation";
  if (part === "channels/order") return "channel-order";
  if (part === "picture") return "server-picture";
  if (part === "soundboard") return "soundboard";
  if (part === "soundboard/play") return "soundboard-play";
  if (part === "voice-move") return "voice-move";
  if (part === "voice-moderation") return "voice-moderation";
  return null;
}

export class RateLimitState {
  private deadlines = new Map<LimitScope, number>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private now: () => number;
  readonly accountId?: string;
  constructor(now: () => number = Date.now, accountId?: string) {
    this.now = now;
    this.accountId = accountId;
  }
  seconds(scope: LimitScope) {
    return Math.max(
      0,
      Math.ceil(((this.deadlines.get(scope) ?? 0) - this.now()) / 1000),
    );
  }
  activeSnapshot = () =>
    JSON.stringify(
      [...this.deadlines.keys()]
        .map((scope) => [scope, this.seconds(scope)])
        .filter(([, seconds]) => Number(seconds) > 0),
    );
  wait(scope: LimitScope, milliseconds: number) {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
    this.deadlines.set(
      scope,
      Math.max(this.deadlines.get(scope) ?? 0, this.now() + milliseconds),
    );
    this.emit();
    this.start();
  }
  observe(scope: LimitScope, response: Pick<Response, "status" | "headers">) {
    if (response.status !== 429) return;
    const retry = response.headers.get("Retry-After");
    const numeric = retry === null ? NaN : Number(retry);
    const duration = Number.isFinite(numeric)
      ? numeric * 1000
      : Date.parse(retry ?? "") - this.now();
    this.wait(
      scope,
      Number.isFinite(duration) && duration > 0 ? duration : 1000,
    );
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    this.start();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.stop();
    };
  };
  private emit() {
    this.listeners.forEach((listener) => listener());
  }
  private start() {
    if (
      this.timer ||
      !this.listeners.size ||
      ![...this.deadlines.values()].some((time) => time > this.now())
    )
      return;
    this.timer = setInterval(() => {
      this.emit();
      if (![...this.deadlines.values()].some((time) => time > this.now()))
        this.stop();
    }, 200);
  }
  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  dispose() {
    this.stop();
    this.deadlines.clear();
    this.listeners.clear();
  }
}

export function waitLabel(seconds: number) {
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`;
}
