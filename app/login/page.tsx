"use client";
import { RateLimitButton } from "../rate-limit-controls";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { LegalLinks } from "../legal-links";

export default function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function login() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await signIn("google", {
        redirect: false,
        callbackUrl: "/",
      });
      if (!result?.ok || !result.url)
        throw new Error("Sign-in could not start. Please try again.");
      window.location.assign(result.url);
    } catch {
      setError("Sign-in could not start. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="loginPage">
      <section className="loginCard">
        <div className="workspaceLogo" aria-label="LZRelay">
          LZR
        </div>
        <span className="workInProgress">Work in progress</span>
        <h1>Welcome to LZRelay</h1>
        <p>
          LZRelay is an active portfolio project and may change while it is
          being developed.
        </p>
        <p>
          Access is restricted to Google accounts allowed by the server owner.
        </p>
        <RateLimitButton
          scope="login"
          disabled={busy}
          onClick={() => void login()}
        >
          Continue with Google
        </RateLimitButton>
        {error && <p role="alert">{error}</p>}
        <small>Demo participants enter through an invitation link.</small>
        <LegalLinks />
      </section>
    </main>
  );
}
