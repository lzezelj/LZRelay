"use client";

import { signIn } from "next-auth/react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { RateLimitButton } from "../../rate-limit-controls";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [error, setError] = useState(false);
  async function open() {
    setError(false);
    try {
      const result = await signIn("demo-invite", {
        token,
        redirect: false,
        callbackUrl: "/",
      });
      if (!result?.ok || !result.url) throw new Error("Sign-in unavailable");
      window.location.assign(result.url);
    } catch {
      setError(true);
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void open(), 0);
    return () => window.clearTimeout(timer);
    // Retry is an explicit user action after the initial token attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return (
    <main className="loginPage">
      {error ? (
        <div>
          <p role="alert">
            The invitation could not be opened. Please try again.
          </p>
          <RateLimitButton scope="login" onClick={() => void open()}>
            Retry invitation
          </RateLimitButton>
        </div>
      ) : (
        <p>Opening your LZRelay invitation...</p>
      )}
    </main>
  );
}
