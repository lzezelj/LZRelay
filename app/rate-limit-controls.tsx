"use client";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import {
  RateLimitState,
  requestLimitScope,
  waitLabel,
  type LimitScope,
} from "./rate-limit-state";
import {
  subscribeVoiceToggle,
  voiceToggleRemaining,
} from "./voice-toggle-cooldown";

const fallback = new RateLimitState();
const Context = createContext(fallback);
export function RateLimitProvider({
  accountId,
  children,
}: {
  accountId?: string;
  children: ReactNode;
}) {
  const state = useMemo(
    () => new RateLimitState(Date.now, accountId),
    [accountId],
  );
  useLayoutEffect(() => {
    let active = true;
    const original = window.fetch;
    const observed: typeof fetch = async (input, options) => {
      const address =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const base =
        window.location.origin === "null"
          ? "http://localhost"
          : window.location.href;
      const url = new URL(address, base);
      const method =
        options?.method ?? (input instanceof Request ? input.method : "GET");
      const body =
        options?.body ??
        (input instanceof Request &&
        url.pathname === "/api/servers" &&
        !input.bodyUsed
          ? await input.clone().text()
          : undefined);
      const scope =
        url.origin === new URL(base).origin
          ? requestLimitScope(url.pathname, method, body)
          : null;
      const signal =
        options?.signal ??
        (input instanceof Request ? input.signal : undefined);
      if (signal?.aborted) throw signal.reason;
      // Sound permits always consult the server: an individual server can
      // explicitly disable that account-wide cooldown.
      if (
        active &&
        scope &&
        scope !== "soundboard-play" &&
        state.seconds(scope)
      ) {
        return Response.json(
          {
            error: `This action is temporarily limited. Try again in ${waitLabel(state.seconds(scope))}.`,
          },
          {
            status: 429,
            headers: { "Retry-After": String(state.seconds(scope)) },
          },
        );
      }
      const response = await original.call(window, input, options);
      if (active && scope) state.observe(scope, response);
      return response;
    };
    window.fetch = observed;
    return () => {
      active = false;
      if (window.fetch === observed) window.fetch = original;
      state.dispose();
    };
  }, [state]);
  return <Context.Provider value={state}>{children}</Context.Provider>;
}

export function useRateLimit(scope?: LimitScope | LimitScope[]) {
  const state = useContext(Context);
  const key = Array.isArray(scope) ? scope.join(",") : (scope ?? "");
  const getSnapshot = useCallback(
    () =>
      key
        ? Math.max(
            ...key.split(",").map((item) => state.seconds(item as LimitScope)),
          )
        : 0,
    [key, state],
  );
  const seconds = useSyncExternalStore(state.subscribe, getSnapshot, () => 0);
  return {
    seconds,
    blocked: () => getSnapshot() > 0,
    wait: (milliseconds: number) => {
      for (const name of key.split(","))
        if (name) state.wait(name as LimitScope, milliseconds);
    },
    observe: (response: Response) => {
      for (const name of key.split(","))
        if (name) state.observe(name as LimitScope, response);
    },
  };
}
const subscribeNever = () => () => {};
const zero = () => 0;
export function useVoiceCooldown(enabled = true) {
  return useSyncExternalStore(
    enabled ? subscribeVoiceToggle : subscribeNever,
    enabled ? voiceToggleRemaining : zero,
    zero,
  );
}
export const RateLimitButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    scope?: LimitScope | LimitScope[];
    voiceCooldown?: boolean;
    cooldownSeconds?: number;
  }
>(function RateLimitButton(
  {
    scope,
    voiceCooldown = false,
    cooldownSeconds = 0,
    disabled,
    children,
    title,
    className = "",
    onClick,
    ...props
  },
  ref,
) {
  const limit = useRateLimit(scope);
  const voice = useVoiceCooldown(voiceCooldown);
  const seconds = Math.max(
    limit.seconds,
    voiceCooldown ? voice : 0,
    cooldownSeconds,
  );
  return (
    <button
      {...props}
      ref={ref}
      className={`${className} ${seconds ? "rateLimitBlocked" : ""}`}
      disabled={disabled || seconds > 0}
      title={seconds ? `Available in ${waitLabel(seconds)}.` : title}
      onClick={(event) => {
        if (
          limit.blocked() ||
          (voiceCooldown && voiceToggleRemaining()) ||
          cooldownSeconds > 0
        ) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClick?.(event);
      }}
    >
      {children}
      {seconds > 0 && (
        <span
          className="rateLimitCountdown"
          aria-label={`Available in ${waitLabel(seconds)}`}
        >
          {waitLabel(seconds)}
        </span>
      )}
    </button>
  );
});
