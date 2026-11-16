"use client";
import { RateLimitButton } from "./rate-limit-controls";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "./avatar";
import { SettingsSection } from "./settings-section";
import { activityLabels, type ActivityEntry } from "./server-activity-types";

type Cursor = { before: string; id: string } | null;
export function ServerActivity({ serverId }: { serverId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [next, setNext] = useState<Cursor>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  async function load(cursor: Cursor = null) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError("");
    try {
      const query = cursor ? `?${new URLSearchParams(cursor)}` : "";
      const response = await fetch(
        `/api/servers/${serverId}/activity${query}`,
        { signal: current.signal },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          data?.error ??
            "Activity could not be loaded. Please try again shortly.",
        );
      if (!data || !Array.isArray(data.entries))
        throw new Error(
          "Activity could not be loaded. Please refresh and try again.",
        );
      if (current.signal.aborted) return;
      setEntries((previous) =>
        cursor
          ? [
              ...previous,
              ...data.entries.filter(
                (item: ActivityEntry) =>
                  !previous.some((row) => row.id === item.id),
              ),
            ]
          : data.entries,
      );
      setNext(data.next);
    } catch (failure) {
      if (!current.signal.aborted) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Activity could not be loaded.",
        );
        // In particular, discard cached privileged records after access is lost.
        setEntries([]);
        setNext(null);
      }
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      controller.current?.abort();
    };
    // The keyed component remounts whenever its server changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);
  return (
    <SettingsSection
      title="Activity log"
      hint="Owner and moderator actions from the last 90 days. Only the server owner and moderators can view this log."
    >
      <RateLimitButton
        scope="server-activity"
        type="button"
        disabled={busy}
        onClick={() => void load()}
      >
        Refresh
      </RateLimitButton>
      {error && <p role="alert">{error}</p>}
      <div className="serverActivityList" aria-busy={busy}>
        {entries.map((entry) => (
          <article className="serverActivityRow" key={entry.id}>
            <Avatar
              name={entry.actorName ?? "Deleted account"}
              image={entry.actorImage}
            />
            <div>
              <strong>{entry.actorName ?? "Deleted account"}</strong>
              <p>{activityLabels[entry.action] ?? entry.action}</p>
              <div className="serverActivityTarget">
                {entry.targetType === "user" && (
                  <Avatar
                    name={entry.targetName ?? "Deleted account"}
                    image={entry.targetImage}
                    small
                  />
                )}
                <span>
                  {entry.targetName ??
                    (entry.targetType === "user"
                      ? "Deleted account"
                      : `${entry.targetType} ${entry.targetId}`)}
                </span>
              </div>
              {Object.keys(entry.details).length > 0 && (
                <dl className="serverActivityDetails">
                  {Object.entries(entry.details).map(([key, value]) => (
                    <div key={key}>
                      <dt>
                        {(
                          {
                            name: "Name",
                            previousName: "Previous name",
                            role: "New role",
                            previousRole: "Previous role",
                            channelId: "From channel",
                            destinationId: "To channel",
                            targetChannelId: "Relative to channel",
                            placement: "Position",
                            enabled: "Enabled",
                            afkChannelId: "AFK channel",
                            previousAfkChannelId: "Previous AFK channel",
                            type: "Channel type",
                          } as Record<string, string>
                        )[key] ?? key}
                      </dt>
                      <dd>
                        {value === null
                          ? "None"
                          : (entry.references?.[String(value)] ??
                            String(value))}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <time dateTime={entry.createdAt}>
                {new Date(entry.createdAt).toLocaleString()}
              </time>
            </div>
          </article>
        ))}
        {!busy && !error && !entries.length && (
          <p className="empty">
            No server activity recorded in the last 90 days.
          </p>
        )}
        {busy && <p role="status">Loading activity…</p>}
      </div>
      {next && (
        <RateLimitButton
          scope="server-activity"
          type="button"
          disabled={busy}
          onClick={() => void load(next)}
        >
          Load older entries
        </RateLimitButton>
      )}
    </SettingsSection>
  );
}
