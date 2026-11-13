"use client";

/**
 * The `/reset#t=…` page (DP-114): the password reset link printed by `iam-cli reset-link`. It sets
 * a new password and still needs the second factor, a current authenticator code or one recovery
 * code (`POST /api/v1/auth/staff/password/reset`, ADR-013 D9). The API ends every session of the
 * account afterwards; the person then signs in normally.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  followLink,
  POLICY_MESSAGES,
  rememberDone,
  rememberInvalid,
  resetPassword,
  tabStore,
} from "../../lib/credential-link";
import { buttonStyles, cx, Spinner } from "../ui";
import {
  AUTH_FIELD,
  ErrorBox,
  Heading,
  LinkEndState,
  PasswordInput,
  RuleCheck,
} from "./link-parts";

type Phase = "loading" | "none" | "invalid" | "done" | "form";

export function ResetFlow() {
  const [phase, setPhase] = useState<Phase>("loading");
  const token = useRef<string | null>(null);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [factor, setFactor] = useState<"code" | "recoveryCode">("code");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; rules: string[] } | null>(null);

  useEffect(
    () =>
      followLink("reset", (state) => {
        setError(null);
        setAnswer("");
        if (state.status === "token") {
          token.current = state.token;
          setPhase("form");
          return;
        }
        token.current = null;
        if (state.status === "done") setPhase("done");
        else if (state.status === "invalid") setPhase("invalid");
        else setPhase("none");
      }),
    [],
  );

  const longEnough = password.length >= 12 && password.length <= 128;
  const matches = password.length > 0 && password === repeat;
  const answerOk =
    factor === "code" ? /^\d{6}$/.test(answer) : /^[0-9A-Za-z]{5}-[0-9A-Za-z]{5}$/.test(answer);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = token.current;
    if (!t || busy || !longEnough || !matches || !answerOk) return;
    setBusy(true);
    setError(null);
    const res = await resetPassword(
      t,
      password,
      factor === "code" ? { code: answer } : { recoveryCode: answer.toUpperCase() },
    );
    setBusy(false);
    setAnswer("");
    if (res.ok) {
      rememberDone(tabStore(), "reset", "reset");
      token.current = null;
      setPassword("");
      setRepeat("");
      setPhase("done");
      return;
    }
    if (res.failure === "link") {
      rememberInvalid(tabStore(), "reset");
      token.current = null;
      setPhase("invalid");
      return;
    }
    setError({
      message: res.message,
      rules: res.failure === "policy" ? res.details.filter((d) => d in POLICY_MESSAGES) : [],
    });
  }

  if (phase === "loading") {
    return (
      <div className="flex items-center gap-3 text-ink-2" role="status">
        <Spinner />
        Checking your link…
      </div>
    );
  }
  if (phase === "none") {
    return (
      <LinkEndState tone="neutral" eyebrow="Password reset" title="Open your reset link">
        <p>
          This page works with the personal reset link from the operator. Open the full link again,
          exactly as you received it.
        </p>
      </LinkEndState>
    );
  }
  if (phase === "invalid") {
    return (
      <LinkEndState tone="problem" eyebrow="Password reset" title="This link cannot be used">
        <p>
          It may have expired, been used already, been replaced by a newer link, or been blocked
          after too many wrong attempts. Ask a platform administrator for a new one.
        </p>
      </LinkEndState>
    );
  }
  if (phase === "done") {
    return (
      <LinkEndState tone="success" eyebrow="Password reset" title="Your password was changed">
        <p>All earlier sessions of your account were signed out. Sign in with the new password.</p>
      </LinkEndState>
    );
  }

  return (
    <div>
      <Heading eyebrow="Password reset" title="Choose a new password">
        <p>Your authenticator stays the same. You need it, or one recovery code, to confirm.</p>
      </Heading>
      <form onSubmit={submit} className="space-y-5" aria-label="Reset password">
        <PasswordInput
          label="New password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          invalid={Boolean(error?.rules.length)}
          autoFocus
          hint={
            <ul className="mt-2 space-y-1.5" aria-label="Password rules">
              <RuleCheck met={longEnough}>12 to 128 characters</RuleCheck>
              <RuleCheck met={matches}>Both entries match</RuleCheck>
            </ul>
          }
        />
        <PasswordInput
          label="Repeat new password"
          name="repeat-password"
          autoComplete="new-password"
          value={repeat}
          onChange={setRepeat}
          invalid={repeat.length > 0 && !matches}
        />
        <div className="space-y-1.5">
          <label htmlFor="reset-answer" className="block text-sm font-medium text-ink">
            {factor === "code" ? "Authenticator code" : "Recovery code"}
          </label>
          <input
            key={factor}
            id="reset-answer"
            name="answer"
            required
            autoComplete="one-time-code"
            value={answer}
            onChange={(e) => setAnswer(e.target.value.trim())}
            {...(factor === "code"
              ? { inputMode: "numeric" as const, pattern: "\\d{6}", maxLength: 6 }
              : { pattern: "[0-9A-Za-z]{5}-[0-9A-Za-z]{5}", maxLength: 11 })}
            className={cx(AUTH_FIELD, "tabular text-lg tracking-[0.2em]")}
          />
          <button
            type="button"
            onClick={() => {
              setFactor(factor === "code" ? "recoveryCode" : "code");
              setAnswer("");
              setError(null);
            }}
            className="rounded text-sm text-petrol hover:text-petrol-strong hover:underline"
          >
            {factor === "code" ? "Use a recovery code instead" : "Use the authenticator instead"}
          </button>
        </div>
        {error ? (
          <ErrorBox>
            <p>{error.message}</p>
            {error.rules.length ? (
              <ul className="list-disc space-y-0.5 pl-4">
                {error.rules.map((r) => (
                  <li key={r}>{POLICY_MESSAGES[r]}</li>
                ))}
              </ul>
            ) : null}
          </ErrorBox>
        ) : null}
        <button
          type="submit"
          disabled={busy || !longEnough || !matches || !answerOk}
          className={cx(buttonStyles.primary, "h-11 w-full")}
        >
          {busy ? <Spinner /> : null}
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
    </div>
  );
}
