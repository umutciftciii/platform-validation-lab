"use client";

/**
 * Building blocks of the credential-link pages (DP-114): step list, password field with a
 * visibility switch, message boxes and the closing states. Nothing here stores or logs a value.
 */
import { useId, useState, type ReactNode } from "react";
import { Icon } from "../icons";
import { buttonStyles, cx } from "../ui";

export const AUTH_FIELD =
  "block h-11 w-full rounded-lg border border-line-strong bg-surface px-3.5 text-[0.9375rem] text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150 hover:border-ink-3 focus:border-petrol focus:outline-none focus:ring-4 focus:ring-petrol/15 aria-invalid:border-danger aria-invalid:focus:ring-danger/15";

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg bg-danger-soft px-3.5 py-3 text-sm text-danger"
    >
      <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

export function NoticeBox({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg bg-surface-2 px-3.5 py-3 text-sm text-ink-2 ring-1 ring-inset ring-line"
    >
      <Icon name="shield" size={17} className="mt-0.5 shrink-0 text-petrol" />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

export interface StepItem {
  key: string;
  label: string;
}

/** Ordered steps; `current` is the active one, earlier ones are done. */
export function StepList({ steps, current }: { steps: readonly StepItem[]; current: number }) {
  return (
    <ol className="mb-8 flex items-center gap-2" aria-label="Progress">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li
            key={s.key}
            className={cx(
              "flex min-w-0 items-center gap-2",
              state === "current" ? "flex-1" : "shrink-0 sm:flex-1 sm:shrink",
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold tabular",
                state === "done" && "bg-petrol text-petrol-ink",
                state === "current" && "bg-petrol/12 text-petrol ring-2 ring-petrol",
                state === "todo" && "bg-surface-2 text-ink-3 ring-1 ring-inset ring-line-strong",
              )}
            >
              {state === "done" ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <span
              className={cx(
                "truncate text-sm",
                // Phones: only the current step is named; the numbers carry the rest.
                state === "current" ? "font-medium text-ink" : "sr-only text-ink-3 sm:not-sr-only",
              )}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className="sr-only">
                {state === "done" ? "Done: " : state === "current" ? "Current step: " : "Next: "}
              </span>
              {s.label}
            </span>
            {i < steps.length - 1 ? (
              <span className="hidden h-px flex-1 bg-line sm:block" aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function PasswordInput({
  label,
  name,
  autoComplete,
  hint,
  invalid,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  name: string;
  autoComplete: "new-password" | "current-password";
  hint?: ReactNode;
  invalid?: boolean;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          maxLength={1024}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cx(AUTH_FIELD, "pr-12")}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-ink-3 hover:text-ink"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
        >
          <Icon name={visible ? "eyeOff" : "eye"} size={18} />
        </button>
      </div>
      {hint ? (
        <div id={`${id}-hint`} className="text-sm text-ink-3">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/** A rule the person can see being met while typing. */
export function RuleCheck({ met, children }: { met: boolean; children: ReactNode }) {
  return (
    <li className={cx("flex items-center gap-2", met ? "text-success" : "text-ink-3")}>
      <span
        aria-hidden="true"
        className={cx(
          "grid size-4 place-items-center rounded-full",
          met ? "bg-success-soft" : "ring-1 ring-inset ring-line-strong",
        )}
      >
        {met ? <Icon name="check" size={11} /> : null}
      </span>
      <span>
        <span className="sr-only">{met ? "Met: " : "Not met yet: "}</span>
        {children}
      </span>
    </li>
  );
}

/** A full-page navigation that replaces this entry: Back cannot return to a spent step. */
export function goToSignIn(): void {
  window.location.replace("/login");
}

export function SignInButton({ children = "Go to sign-in" }: { children?: ReactNode }) {
  return (
    <button type="button" onClick={goToSignIn} className={cx(buttonStyles.primary, "h-11 w-full")}>
      {children}
      <Icon name="arrow" size={16} />
    </button>
  );
}

export function Heading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {eyebrow ? (
        <p className="type-eyebrow mb-3 flex items-center gap-2 text-ink-3">
          <span className="h-px w-5 bg-brand" aria-hidden="true" />
          {eyebrow}
        </p>
      ) : null}
      <h1 className="type-display text-[2rem] font-semibold leading-tight text-ink">{title}</h1>
      {children ? <div className="mt-2 text-ink-2">{children}</div> : null}
    </header>
  );
}

/** Closing state of a link page: the link is spent, missing or refused. */
export function LinkEndState({
  tone,
  eyebrow,
  title,
  children,
  action = "signin",
}: {
  tone: "success" | "problem" | "neutral";
  eyebrow?: string;
  title: string;
  children: ReactNode;
  action?: "signin" | "none";
}) {
  return (
    <div>
      <span
        aria-hidden="true"
        className={cx(
          "mb-6 grid size-12 place-items-center rounded-full",
          tone === "success" && "bg-success-soft text-success",
          tone === "problem" && "bg-danger-soft text-danger",
          tone === "neutral" && "bg-surface-2 text-ink-3 ring-1 ring-inset ring-line",
        )}
      >
        <Icon
          name={tone === "success" ? "check" : tone === "problem" ? "alert" : "key"}
          size={22}
        />
      </span>
      <Heading eyebrow={eyebrow} title={title} />
      <div className="mb-8 space-y-3 text-ink-2">{children}</div>
      {action === "signin" ? <SignInButton /> : null}
    </div>
  );
}
