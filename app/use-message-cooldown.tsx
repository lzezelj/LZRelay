"use client";
import { useRateLimit } from "./rate-limit-controls";

export function useMessageCooldown() {
  const limit = useRateLimit("message");
  return {
    seconds: limit.seconds,
    blocked: limit.blocked,
    handleResponse(response: Response) {
      if (response.status !== 429) return false;
      limit.observe(response);
      return true;
    },
  };
}
