"use client";

import { ErrorBodySchema, type ErrorCode } from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { secureCookiesBlocked } from "../../lib/cookie-support";
import { createTranslator } from "../../lib/i18n/translate";
import type { Translate } from "../../lib/i18n/types";
import { useT } from "../i18n/locale-provider";
import { Icon } from "../icons";
import { buttonStyles, cx, Spinner } from "../ui";

const LOGIN_PATH = "/api/v1/auth/staff/login";
const MFA_PATH = "/api/v1/auth/staff/login/mfa";

type Step = "credentials" | "mfa";
type Factor = "code" | "recoveryCode";

/**
 * Message for a failed call, in the console's language: the text for a known error code (English
 * equals the contract's text), a generic one otherwise.
 */
export async function messageFor(
  response: Response,
  t: Translate = createTranslator("en"),
): Promise<{ code?: ErrorCode; text: string }> {
  if (response.status === 429) {
    return { text: t("auth.tooManyAttempts") };
  }
  const parsed = ErrorBodySchema.safeParse(await response.json().catch(() => null));
  if (parsed.success) {
    const code = parsed.data.error.code;
    const cookieMissing = parsed.data.error.details.some(
      (d) => typeof d === "object" && d.path === "cookie" && d.rule === "missing",
    );
    if (code === "AUTH_CHALLENGE_EXPIRED" && cookieMissing) {
      // DP-119: the browser dropped the challenge cookie of the first step.
      return { code, text: t("auth.cookiesBlocked") };
    }
    if (code === "AUTH_CSRF_REJECTED") {
      // The API only accepts sign-ins from the console's configured address (Origin check).
      return { code, text: t("login.csrfRejected") };
    }
    return { code, text: t(`errors.${code}`) };
  }
  return { text: t("login.unavailable") };
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });
}

const FIELD =
  "block h-11 w-full rounded-lg border border-line-strong bg-surface px-3.5 text-[0.9375rem] text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150 hover:border-ink-3 focus:border-petrol focus:outline-none focus:ring-4 focus:ring-petrol/15 aria-invalid:border-danger aria-invalid:focus:ring-danger/15";

const noopSubscribe = () => () => {};
let cookieProbe: boolean | undefined;

export function LoginForm() {
  const router = useRouter();
  const t = useT();
  // false in the server HTML and until React has hydrated. Submitting is blocked until then, so
  // a quick Enter can never fall back to a native form submission.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  // DP-119: known before the first attempt, read once after hydration (null on the server).
  const cookiesBlocked = useSyncExternalStore(
    noopSubscribe,
    () => (cookieProbe ??= secureCookiesBlocked(document)),
    () => false,
  );
  const [step, setStep] = useState<Step>("credentials");
  const [factor, setFactor] = useState<Factor>("code");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  async function submitCredentials(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const res = await postJson(LOGIN_PATH, {
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      });
      if (res.ok) {
        setStep("mfa");
        requestAnimationFrame(() => codeRef.current?.focus());
      } else {
        setError((await messageFor(res, t)).text);
      }
    } catch {
      setError(t("auth.unreachable"));
    } finally {
      setPending(false);
    }
  }

  async function submitMfa(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get("answer") ?? "").trim();
    setPending(true);
    setError(null);
    try {
      const res = await postJson(
        MFA_PATH,
        factor === "code" ? { code: value } : { recoveryCode: value.toUpperCase() },
      );
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      const { code, text } = await messageFor(res, t);
      if (code === "AUTH_CHALLENGE_EXPIRED") setStep("credentials");
      setError(text);
      setPending(false);
    } catch {
      setError(t("auth.unreachable"));
      setPending(false);
    }
  }

  const errorBox = error ? (
    <p
      role="alert"
      className="flex items-start gap-2.5 rounded-lg bg-danger-soft px-3.5 py-3 text-sm text-danger"
    >
      <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
      {error}
    </p>
  ) : null;

  const cookieNotice = cookiesBlocked ? (
    <p
      role="status"
      className="flex items-start gap-2.5 rounded-lg bg-amber-soft px-3.5 py-3 text-sm text-amber-ink"
    >
      <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
      {t("auth.cookiesBlocked")}
    </p>
  ) : null;

  if (step === "credentials") {
    return (
      <form method="post" onSubmit={submitCredentials} className="space-y-5">
        {cookieNotice}
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-sm font-medium text-ink">
            {t("login.workEmail")}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={320}
            className={FIELD}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium text-ink">
            {t("login.password")}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1024}
            className={FIELD}
          />
        </div>
        {errorBox}
        <button
          type="submit"
          disabled={pending || !hydrated}
          className={cx(buttonStyles.primary, "h-11 w-full")}
        >
          {pending ? (
            <>
              <Spinner />
              {t("auth.checking")}
            </>
          ) : (
            t("login.continue")
          )}
        </button>
      </form>
    );
  }

  return (
    <form method="post" onSubmit={submitMfa} className="space-y-5">
      <div className="space-y-1.5">
        <label htmlFor="answer" className="block text-sm font-medium text-ink">
          {factor === "code" ? t("auth.authenticatorCode") : t("auth.recoveryCode")}
        </label>
        <p id="answer-help" className="text-sm text-ink-3">
          {factor === "code" ? t("login.codeHelp") : t("login.recoveryHelp")}
        </p>
        <input
          key={factor}
          ref={codeRef}
          id="answer"
          name="answer"
          aria-describedby="answer-help"
          required
          autoComplete="one-time-code"
          {...(factor === "code"
            ? { inputMode: "numeric" as const, pattern: "\\d{6}", maxLength: 6 }
            : { pattern: "[0-9A-Za-z]{5}-[0-9A-Za-z]{5}", maxLength: 11 })}
          className={cx(FIELD, "tabular text-lg tracking-[0.2em]")}
        />
      </div>
      {errorBox}
      <button
        type="submit"
        disabled={pending || !hydrated}
        className={cx(buttonStyles.primary, "h-11 w-full")}
      >
        {pending ? (
          <>
            <Spinner />
            {t("auth.verifying")}
          </>
        ) : (
          t("login.signIn")
        )}
      </button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button
          type="button"
          onClick={() => {
            setFactor(factor === "code" ? "recoveryCode" : "code");
            setError(null);
          }}
          className="rounded text-petrol hover:text-petrol-strong hover:underline"
        >
          {factor === "code" ? t("auth.useRecoveryCode") : t("auth.useAuthenticator")}
        </button>
        <button
          type="button"
          onClick={() => {
            setStep("credentials");
            setFactor("code");
            setError(null);
          }}
          className="rounded text-ink-3 hover:text-ink"
        >
          {t("login.startOver")}
        </button>
      </div>
    </form>
  );
}
