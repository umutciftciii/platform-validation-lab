"use client";

/**
 * The `/enrol#t=…` page (DP-114): activation of the first administrator, staff invitation,
 * operator recovery (also the system owner's: `owner-recover`) and MFA re-enrolment, on the
 * existing endpoints `/api/v1/auth/staff/enrol/*` (F1-002 Group 2, ADR-013 D9). The API decides
 * everything; this page only walks through the steps:
 *
 *   password (new, or the current one for a re-enrolment) → authenticator (QR + live code)
 *   → recovery codes, shown once → sign in normally.
 *
 * See lib/credential-link.ts for how the token is kept out of the address bar and history.
 */
import type { EnrolInspectResponse, EnrolKind, EnrolMfaSetupResponse } from "@dream/contracts";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  confirmAuthenticator,
  followLink,
  groupSecret,
  inspectLink,
  KIND_COPY,
  POLICY_MESSAGES,
  proveCurrentPassword,
  recoveryCodesText,
  rememberDone,
  rememberInvalid,
  setNewPassword,
  startAuthenticator,
  tabStore,
  type LinkCall,
} from "../../lib/credential-link";
import { qrPath } from "../../lib/qr";
import { Icon } from "../icons";
import { buttonStyles, cx, Spinner } from "../ui";
import {
  AUTH_FIELD,
  ErrorBox,
  goToSignIn,
  Heading,
  LinkEndState,
  NoticeBox,
  PasswordInput,
  RuleCheck,
  StepList,
} from "./link-parts";

const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

const EXPIRY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
  timeZoneName: "short",
});

type Phase =
  | { name: "loading" }
  | { name: "none" }
  | { name: "invalid"; message?: string }
  | { name: "done"; kind: EnrolKind | "reset" }
  | { name: "unreachable" }
  | { name: "password" }
  | { name: "mfa" }
  | { name: "codes"; codes: string[] };

export function EnrolFlow() {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [info, setInfo] = useState<EnrolInspectResponse | null>(null);
  const [token, setToken] = useState<string | null>(null);

  /** The link stopped working mid-flow: remember it, so a reload says the same thing. */
  const endLink = useCallback((message?: string) => {
    rememberInvalid(tabStore(), "enrol");
    setToken(null);
    setPhase({ name: "invalid", message });
  }, []);

  const inspect = useCallback(
    async (t: string) => {
      const res = await inspectLink(t);
      if (res.ok) {
        setInfo(res.data);
        const passwordDone = res.data.steps.some((s) => s.step !== "mfa" && s.done);
        setPhase(passwordDone ? { name: "mfa" } : { name: "password" });
      } else if (res.failure === "link") {
        endLink();
      } else {
        setPhase({ name: "unreachable" });
      }
    },
    [endLink],
  );

  useEffect(
    () =>
      followLink("enrol", (state) => {
        setInfo(null);
        if (state.status === "token") {
          setToken(state.token);
          setPhase({ name: "loading" });
          void inspect(state.token);
          return;
        }
        setToken(null);
        if (state.status === "done") setPhase({ name: "done", kind: state.kind });
        else if (state.status === "invalid") setPhase({ name: "invalid" });
        else setPhase({ name: "none" });
      }),
    [inspect],
  );

  const backToPassword = useCallback(() => setPhase({ name: "password" }), []);

  const kind = info?.kind ?? "activation";
  const copy = KIND_COPY[kind];

  switch (phase.name) {
    case "loading":
      return (
        <div className="flex items-center gap-3 text-ink-2" role="status">
          <Spinner />
          Checking your link…
        </div>
      );
    case "none":
      return (
        <LinkEndState tone="neutral" eyebrow="Account setup" title="Open your link">
          <p>
            This page works with the personal link from your invitation or from the operator. Open
            the full link again, exactly as you received it.
          </p>
          <p className="text-sm text-ink-3">
            For your safety the link is removed from the address bar as soon as the page opens, so
            copying the address from here does not work.
          </p>
        </LinkEndState>
      );
    case "invalid":
      return (
        <LinkEndState tone="problem" eyebrow="Account setup" title="This link cannot be used">
          <p>
            {phase.message ??
              "It may have expired, been used already, been replaced by a newer link, or been blocked after too many wrong attempts."}
          </p>
          <p>
            Ask a platform administrator for a new link. If you already finished setting up your
            account, sign in instead.
          </p>
        </LinkEndState>
      );
    case "done":
      return (
        <LinkEndState tone="success" eyebrow="Account ready" title="You are all set">
          <p>Your password and authenticator are set up. Sign in with them now.</p>
          <p className="text-sm text-ink-3">
            The recovery codes were shown once and are not stored in this browser. If you did not
            save them, ask a platform administrator for help.
          </p>
        </LinkEndState>
      );
    case "unreachable":
      return (
        <LinkEndState tone="problem" title="The admin service is not reachable" action="none">
          <p>Your link was not used. Check your connection and try again.</p>
          <button
            type="button"
            className={cx(buttonStyles.primary, "h-11 w-full")}
            onClick={() => {
              setPhase({ name: "loading" });
              if (token) void inspect(token);
            }}
          >
            <Icon name="refresh" size={16} />
            Try again
          </button>
        </LinkEndState>
      );
    case "codes":
      return (
        <RecoveryCodes
          codes={phase.codes}
          emailMasked={info?.emailMasked ?? ""}
          steps={stepsFor(kind)}
        />
      );
    default:
      break;
  }

  return (
    <div>
      <StepList steps={stepsFor(kind)} current={phase.name === "password" ? 0 : 1} />
      <Heading eyebrow={copy.eyebrow} title={copy.title}>
        <p>{copy.intro}</p>
      </Heading>
      {info ? (
        <p className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="key" size={15} />
            <span className="font-medium text-ink-2">{info.emailMasked}</span>
          </span>
          <span aria-hidden="true" className="hidden sm:inline">
            ·
          </span>
          <span>Link valid until {EXPIRY.format(new Date(info.expiresAt))}</span>
        </p>
      ) : null}
      {phase.name === "password" ? (
        <PasswordStep
          kind={kind}
          token={token ?? ""}
          onDone={() => setPhase({ name: "mfa" })}
          onLinkEnd={endLink}
        />
      ) : (
        <AuthenticatorStep
          token={token ?? ""}
          onBackToPassword={backToPassword}
          onLinkEnd={endLink}
          onDone={(codes) => {
            // The link is spent now; a reload must say "done", never "invalid link".
            rememberDone(tabStore(), "enrol", kind);
            setToken(null);
            setPhase({ name: "codes", codes });
          }}
        />
      )}
    </div>
  );
}

function stepsFor(kind: EnrolKind) {
  return [
    { key: "password", label: kind === "mfa_reenrolment" ? "Confirm password" : "Password" },
    { key: "mfa", label: "Authenticator" },
    { key: "codes", label: "Recovery codes" },
  ];
}

// --- step 1: password --------------------------------------------------------------------------

function PasswordStep({
  kind,
  token,
  onDone,
  onLinkEnd,
}: {
  kind: EnrolKind;
  token: string;
  onDone: () => void;
  onLinkEnd: (message?: string) => void;
}) {
  const reenrol = kind === "mfa_reenrolment";
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; rules: string[] } | null>(null);

  const longEnough = password.length >= MIN_LENGTH;
  const notTooLong = password.length <= MAX_LENGTH;
  const matches = password.length > 0 && password === repeat;
  const ready = reenrol ? password.length > 0 : longEnough && notTooLong && matches;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const res: LinkCall<void> = reenrol
      ? await proveCurrentPassword(token, password)
      : await setNewPassword(token, password);
    setBusy(false);
    if (res.ok) {
      setPassword("");
      setRepeat("");
      onDone();
      return;
    }
    if (res.failure === "link") return onLinkEnd();
    setError({
      message: res.message,
      rules: res.failure === "policy" ? res.details.filter((d) => d in POLICY_MESSAGES) : [],
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-5"
      aria-label={reenrol ? "Confirm password" : "Set password"}
    >
      {reenrol ? (
        <PasswordInput
          label="Current password"
          name="current-password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          invalid={Boolean(error)}
          autoFocus
          hint="Your password did not change. Confirming it shows the reset reached the right person."
        />
      ) : (
        <>
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
                <RuleCheck met={longEnough && notTooLong}>
                  {MIN_LENGTH} to {MAX_LENGTH} characters; a passphrase of several words works well
                </RuleCheck>
                <RuleCheck met={matches}>Both entries match</RuleCheck>
                <li className="pl-6 text-ink-3">
                  Not a known breached password, and without your name or e-mail address.
                </li>
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
        </>
      )}
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
        disabled={!ready || busy}
        className={cx(buttonStyles.primary, "h-11 w-full")}
      >
        {busy ? <Spinner /> : null}
        {busy ? "Checking…" : reenrol ? "Confirm and continue" : "Save password and continue"}
      </button>
    </form>
  );
}

// --- step 2: authenticator ---------------------------------------------------------------------

function AuthenticatorStep({
  token,
  onDone,
  onBackToPassword,
  onLinkEnd,
}: {
  token: string;
  onDone: (codes: string[]) => void;
  onBackToPassword: () => void;
  onLinkEnd: (message?: string) => void;
}) {
  const [setup, setSetup] = useState<EnrolMfaSetupResponse | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const begin = useCallback(async () => {
    const res = await startAuthenticator(token);
    if (res.ok) {
      setSetup(res.data);
      setSetupError(null);
      return;
    }
    if (res.failure === "link") return onLinkEnd();
    if (res.failure === "state") return onBackToPassword();
    setSetupError(res.message);
  }, [token, onLinkEnd, onBackToPassword]);

  useEffect(() => {
    // Each setup replaces the key on the server: start it once per visit of this step, also
    // under React's development double effects, so the QR code on screen is the live key.
    if (started.current) return;
    started.current = true;
    void Promise.resolve().then(begin);
  }, [begin]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await confirmAuthenticator(token, code);
    setBusy(false);
    setCode("");
    if (res.ok) {
      setSetup(null);
      onDone(res.data.recoveryCodes);
      return;
    }
    if (res.failure === "link") return onLinkEnd();
    if (res.failure === "state") {
      // The unconfirmed setup expired: a new key replaces it.
      setSetup(null);
      setNotice("The setup timed out. Remove the old entry from your app and scan the new code.");
      await begin();
      return;
    }
    setError(res.message);
    requestAnimationFrame(() => codeRef.current?.focus());
  }

  if (setupError) {
    return (
      <div className="space-y-4">
        <ErrorBox>
          <p>{setupError}</p>
        </ErrorBox>
        <button
          type="button"
          className={cx(buttonStyles.secondary, "h-11 w-full")}
          onClick={() => {
            setSetupError(null);
            void begin();
          }}
        >
          <Icon name="refresh" size={16} />
          Try again
        </button>
      </div>
    );
  }
  if (!setup) {
    return (
      <div className="flex items-center gap-3 text-ink-2" role="status">
        <Spinner />
        Preparing your authenticator key…
      </div>
    );
  }

  const qr = qrPath(setup.otpauthUri);
  return (
    <div className="space-y-6">
      {notice ? <NoticeBox>{notice}</NoticeBox> : null}
      <ol className="space-y-6">
        <li className="space-y-3">
          <p className="text-sm font-medium text-ink">
            1. Scan this code with your authenticator app
          </p>
          <p className="text-sm text-ink-3">
            For example Microsoft Authenticator, Google Authenticator, 1Password or Authy.
          </p>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            {/* Always dark modules on white: scanners need the contrast in both themes. */}
            <div className="rounded-xl bg-white p-2 ring-1 ring-line">
              <svg
                role="img"
                aria-label="QR code for your authenticator app"
                viewBox={`0 0 ${qr.size} ${qr.size}`}
                width={184}
                height={184}
                shapeRendering="crispEdges"
              >
                <rect width={qr.size} height={qr.size} fill="#ffffff" />
                <path d={qr.d} fill="#0b1b2e" />
              </svg>
            </div>
            <div className="min-w-0 space-y-2 text-sm">
              <p className="text-ink-3">Cannot scan? Enter this key in the app instead:</p>
              <p className="tabular select-all break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-[0.9375rem] tracking-wider text-ink ring-1 ring-inset ring-line">
                {groupSecret(setup.secret)}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonStyles.ghost}
                  onClick={() => {
                    void navigator.clipboard?.writeText(setup.secret).then(() => setCopied(true));
                  }}
                >
                  <Icon name={copied ? "check" : "document"} size={15} />
                  {copied ? "Key copied" : "Copy key"}
                </button>
                {/* On a phone the QR code cannot be scanned by the same phone: open the app. */}
                <a href={setup.otpauthUri} className={cx(buttonStyles.ghost, "lg:hidden")}>
                  <Icon name="key" size={15} />
                  Open in authenticator app
                </a>
              </div>
            </div>
          </div>
        </li>
        <li>
          <form onSubmit={submit} className="space-y-3" aria-label="Confirm authenticator">
            <label htmlFor="enrol-code" className="block text-sm font-medium text-ink">
              2. Enter the 6-digit code the app shows
            </label>
            <input
              ref={codeRef}
              id="enrol-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-invalid={Boolean(error) || undefined}
              className={cx(AUTH_FIELD, "tabular text-lg tracking-[0.3em]")}
            />
            {error ? (
              <ErrorBox>
                <p>{error}</p>
                <p className="text-danger/80">
                  Check that the time on your phone is set automatically.
                </p>
              </ErrorBox>
            ) : null}
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className={cx(buttonStyles.primary, "h-11 w-full")}
            >
              {busy ? <Spinner /> : null}
              {busy ? "Verifying…" : "Verify and activate"}
            </button>
          </form>
        </li>
      </ol>
      <p className="text-xs text-ink-3">
        Reloaded this page? A new key was created; only the newest entry in your app works.
      </p>
    </div>
  );
}

// --- step 3: recovery codes --------------------------------------------------------------------

function RecoveryCodes({
  codes,
  emailMasked,
  steps,
}: {
  codes: string[];
  emailMasked: string;
  steps: ReturnType<typeof stepsFor>;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  function download() {
    const blob = new Blob([recoveryCodesText(codes, emailMasked)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dream-petroleum-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <StepList steps={steps} current={2} />
      <Heading eyebrow="Account active" title="Save your recovery codes">
        <p>
          If your phone is lost, each code signs you in once instead of the authenticator. They are
          shown only now and cannot be displayed again.
        </p>
      </Heading>
      <ul
        className="tabular mb-4 grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-4 font-mono text-[0.9375rem] tracking-wider text-ink ring-1 ring-inset ring-line"
        aria-label="Recovery codes"
      >
        {codes.map((c) => (
          <li key={c} className="select-all text-center">
            {c}
          </li>
        ))}
      </ul>
      <div className="mb-6 flex flex-wrap gap-2">
        <button type="button" className={buttonStyles.secondary} onClick={download}>
          <Icon name="download" size={15} />
          Download .txt
        </button>
        <button
          type="button"
          className={buttonStyles.secondary}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(recoveryCodesText(codes, emailMasked))
              .then(() => setCopied(true));
          }}
        >
          <Icon name={copied ? "check" : "document"} size={15} />
          {copied ? "Copied" : "Copy all"}
        </button>
      </div>
      <label className="mb-5 flex cursor-pointer items-start gap-3 text-sm text-ink-2">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="mt-0.5 size-4 accent-petrol"
        />
        I have stored these codes somewhere safe, away from my phone.
      </label>
      <button
        type="button"
        disabled={!saved}
        onClick={goToSignIn}
        className={cx(buttonStyles.primary, "h-11 w-full")}
      >
        Continue to sign-in
        <Icon name="arrow" size={16} />
      </button>
    </div>
  );
}
