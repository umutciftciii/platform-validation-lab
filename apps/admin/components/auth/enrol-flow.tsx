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
  failureMessage,
  followLink,
  groupSecret,
  inspectLink,
  isPolicyRule,
  type PolicyRule,
  proveCurrentPassword,
  recoveryCodesText,
  rememberDone,
  rememberInvalid,
  setNewPassword,
  startAuthenticator,
  tabStore,
  type LinkCall,
} from "../../lib/credential-link";
import { formatLinkExpiry } from "../../lib/i18n/format";
import type { Translate } from "../../lib/i18n/types";
import { qrPath } from "../../lib/qr";
import { useAdminLocale, useT } from "../i18n/locale-provider";
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
  const t = useT();
  const locale = useAdminLocale();

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

  switch (phase.name) {
    case "loading":
      return (
        <div className="flex items-center gap-3 text-ink-2" role="status">
          <Spinner />
          {t("link.checkingLink")}
        </div>
      );
    case "none":
      return (
        <LinkEndState
          tone="neutral"
          eyebrow={t("enrol.accountSetup")}
          title={t("enrol.openLinkTitle")}
        >
          <p>{t("enrol.openLinkText")}</p>
          <p className="text-sm text-ink-3">{t("enrol.openLinkSafety")}</p>
        </LinkEndState>
      );
    case "invalid":
      return (
        <LinkEndState
          tone="problem"
          eyebrow={t("enrol.accountSetup")}
          title={t("link.invalidTitle")}
        >
          <p>{phase.message ?? t("enrol.invalidText")}</p>
          <p>{t("enrol.invalidAsk")}</p>
        </LinkEndState>
      );
    case "done":
      return (
        <LinkEndState tone="success" eyebrow={t("enrol.accountReady")} title={t("enrol.doneTitle")}>
          <p>{t("enrol.doneText")}</p>
          <p className="text-sm text-ink-3">{t("enrol.doneCodes")}</p>
        </LinkEndState>
      );
    case "unreachable":
      return (
        <LinkEndState tone="problem" title={t("enrol.unreachableTitle")} action="none">
          <p>{t("enrol.unreachableText")}</p>
          <button
            type="button"
            className={cx(buttonStyles.primary, "h-11 w-full")}
            onClick={() => {
              setPhase({ name: "loading" });
              if (token) void inspect(token);
            }}
          >
            <Icon name="refresh" size={16} />
            {t("common.tryAgain")}
          </button>
        </LinkEndState>
      );
    case "codes":
      return (
        <RecoveryCodes
          codes={phase.codes}
          emailMasked={info?.emailMasked ?? ""}
          steps={stepsFor(kind, t)}
        />
      );
    default:
      break;
  }

  return (
    <div>
      <StepList steps={stepsFor(kind, t)} current={phase.name === "password" ? 0 : 1} />
      <Heading eyebrow={t(`enrol.kinds.${kind}.eyebrow`)} title={t(`enrol.kinds.${kind}.title`)}>
        <p>{t(`enrol.kinds.${kind}.intro`)}</p>
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
          <span>
            {t("enrol.linkValidUntil", {
              date: formatLinkExpiry(new Date(info.expiresAt), locale),
            })}
          </span>
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

function stepsFor(kind: EnrolKind, t: Translate) {
  return [
    {
      key: "password",
      label:
        kind === "mfa_reenrolment" ? t("enrol.steps.confirmPassword") : t("enrol.steps.password"),
    },
    { key: "mfa", label: t("enrol.steps.authenticator") },
    { key: "codes", label: t("enrol.steps.recoveryCodes") },
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
  const [error, setError] = useState<{ message: string; rules: PolicyRule[] } | null>(null);
  const t = useT();

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
      message: failureMessage(res.failure, res.code, t),
      rules: res.failure === "policy" ? res.details.filter(isPolicyRule) : [],
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-5"
      aria-label={reenrol ? t("enrol.steps.confirmPassword") : t("enrol.setPassword")}
    >
      {reenrol ? (
        <PasswordInput
          label={t("enrol.currentPassword")}
          name="current-password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          invalid={Boolean(error)}
          autoFocus
          hint={t("enrol.currentPasswordHint")}
        />
      ) : (
        <>
          <PasswordInput
            label={t("link.newPassword")}
            name="new-password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            invalid={Boolean(error?.rules.length)}
            autoFocus
            hint={
              <ul className="mt-2 space-y-1.5" aria-label={t("link.passwordRules")}>
                <RuleCheck met={longEnough && notTooLong}>
                  {t("enrol.lengthRule", { min: MIN_LENGTH, max: MAX_LENGTH })}
                </RuleCheck>
                <RuleCheck met={matches}>{t("link.bothMatch")}</RuleCheck>
                <li className="pl-6 text-ink-3">{t("enrol.breachedRule")}</li>
              </ul>
            }
          />
          <PasswordInput
            label={t("link.repeatNewPassword")}
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
                <li key={r}>{t(`link.policy.${r}`)}</li>
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
        <span>
          {busy
            ? t("auth.checking")
            : reenrol
              ? t("enrol.confirmAndContinue")
              : t("enrol.savePasswordAndContinue")}
        </span>
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
  const t = useT();

  const begin = useCallback(async () => {
    const res = await startAuthenticator(token);
    if (res.ok) {
      setSetup(res.data);
      setSetupError(null);
      return;
    }
    if (res.failure === "link") return onLinkEnd();
    if (res.failure === "state") return onBackToPassword();
    setSetupError(failureMessage(res.failure, res.code, t));
  }, [token, onLinkEnd, onBackToPassword, t]);

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
      setNotice(t("enrol.setupTimedOut"));
      await begin();
      return;
    }
    setError(failureMessage(res.failure, res.code, t));
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
          {t("common.tryAgain")}
        </button>
      </div>
    );
  }
  if (!setup) {
    return (
      <div className="flex items-center gap-3 text-ink-2" role="status">
        <Spinner />
        {t("enrol.preparingKey")}
      </div>
    );
  }

  const qr = qrPath(setup.otpauthUri);
  return (
    <div className="space-y-6">
      {notice ? <NoticeBox>{notice}</NoticeBox> : null}
      <ol className="space-y-6">
        <li className="space-y-3">
          <p className="text-sm font-medium text-ink">{t("enrol.scanStep")}</p>
          <p className="text-sm text-ink-3">{t("enrol.appExamples")}</p>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            {/* Always dark modules on white: scanners need the contrast in both themes. */}
            <div className="rounded-xl bg-white p-2 ring-1 ring-line">
              <svg
                role="img"
                aria-label={t("enrol.qrLabel")}
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
              <p className="text-ink-3">{t("enrol.cannotScan")}</p>
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
                  {copied ? t("enrol.keyCopied") : t("enrol.copyKey")}
                </button>
                {/* On a phone the QR code cannot be scanned by the same phone: open the app. */}
                <a href={setup.otpauthUri} className={cx(buttonStyles.ghost, "lg:hidden")}>
                  <Icon name="key" size={15} />
                  {t("enrol.openInApp")}
                </a>
              </div>
            </div>
          </div>
        </li>
        <li>
          <form
            onSubmit={submit}
            className="space-y-3"
            aria-label={t("enrol.confirmAuthenticator")}
          >
            <label htmlFor="enrol-code" className="block text-sm font-medium text-ink">
              {t("enrol.enterCodeStep")}
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
                <p className="text-danger/80">{t("enrol.phoneTime")}</p>
              </ErrorBox>
            ) : null}
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className={cx(buttonStyles.primary, "h-11 w-full")}
            >
              {busy ? <Spinner /> : null}
              <span>{busy ? t("auth.verifying") : t("enrol.verifyAndActivate")}</span>
            </button>
          </form>
        </li>
      </ol>
      <p className="text-xs text-ink-3">{t("enrol.reloadedNote")}</p>
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
  const t = useT();

  function download() {
    const blob = new Blob([recoveryCodesText(codes, emailMasked, t)], { type: "text/plain" });
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
      <Heading eyebrow={t("enrol.accountActive")} title={t("enrol.codesTitle")}>
        <p>{t("enrol.codesText")}</p>
      </Heading>
      <ul
        className="tabular mb-4 grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-4 font-mono text-[0.9375rem] tracking-wider text-ink ring-1 ring-inset ring-line"
        aria-label={t("enrol.codesLabel")}
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
          {t("enrol.downloadTxt")}
        </button>
        <button
          type="button"
          className={buttonStyles.secondary}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(recoveryCodesText(codes, emailMasked, t))
              .then(() => setCopied(true));
          }}
        >
          <Icon name={copied ? "check" : "document"} size={15} />
          {copied ? t("enrol.copied") : t("enrol.copyAll")}
        </button>
      </div>
      <label className="mb-5 flex cursor-pointer items-start gap-3 text-sm text-ink-2">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="mt-0.5 size-4 accent-petrol"
        />
        {t("enrol.codesStored")}
      </label>
      <button
        type="button"
        disabled={!saved}
        onClick={goToSignIn}
        className={cx(buttonStyles.primary, "h-11 w-full")}
      >
        {t("enrol.continueToSignIn")}
        <Icon name="arrow" size={16} />
      </button>
    </div>
  );
}
