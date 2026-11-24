"use client";
/**
 * DP-268: the console's one modal dialog. Confirmations (CMS publish/unpublish/restore, redirect
 * delete, staff role removal) and short forms (redirect create/edit, owner module reason) open in
 * it instead of expanding inside the page.
 *
 * Built on the native <dialog> opened with showModal(): the browser puts it in the top layer and
 * makes the rest of the page inert (no pointer, keyboard or screen-reader access behind it).
 * On top of that, this component
 * - moves focus in on open: the element marked `data-autofocus`, else the first focusable control
 *   of the body, else the dialog itself;
 * - keeps Tab and Shift+Tab inside the dialog (wraps at both ends);
 * - closes on Escape only through `onClose`, and never while `busy` (a request is running);
 *   with unsaved input (`dirty`) Escape first asks for confirmation. The visible Cancel button keeps
 *   each screen's own rule;
 * - gives focus back to the element that opened it (or `#main` when that element is gone or
 *   disabled after the action).
 *
 * The parent mounts the dialog only while it is open (`{open ? <Dialog …/> : null}`). The component
 * holds no React state, so the static render tests that queue useState values are unaffected.
 */
import {
  useId,
  useLayoutEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useT } from "./i18n/locale-provider";
import { Icon } from "./icons";
import { buttonStyles, cx, Spinner } from "./ui";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

/** Keyboard-reachable controls inside `root`, in document order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // :disabled also covers controls inside a disabled <fieldset> (a protected redirect's fields).
    (el) =>
      el.tabIndex >= 0 &&
      !el.matches(":disabled") &&
      !el.closest("[inert]") &&
      el.getClientRects().length > 0,
  );
}

/**
 * Where Tab (or Shift+Tab) should go so that focus stays inside the container: the index of the
 * control to focus, or null when the browser's own move already stays inside.
 */
export function wrapTarget(count: number, current: number, backwards: boolean): number | null {
  if (count === 0) return null;
  if (current < 0) return backwards ? count - 1 : 0;
  if (backwards && current === 0) return count - 1;
  if (!backwards && current === count - 1) return 0;
  return null;
}

/** Keeps Tab/Shift+Tab inside `container` (also used by the phone navigation drawer). */
export function trapTab(e: ReactKeyboardEvent | KeyboardEvent, container: HTMLElement | null) {
  if (e.key !== "Tab" || !container) return;
  const items = focusableIn(container);
  const active = document.activeElement as HTMLElement | null;
  const target = wrapTarget(items.length, active ? items.indexOf(active) : -1, e.shiftKey);
  if (items.length === 0) {
    e.preventDefault();
    container.focus();
    return;
  }
  if (target === null) return;
  e.preventDefault();
  items[target]?.focus();
}

function canTakeFocus(el: Element | null): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    el.isConnected &&
    !el.matches(":disabled") &&
    !el.closest("[inert]") &&
    el.getClientRects().length > 0
  );
}

/**
 * The action often refreshes the page after the dialog closed: a deleted row (with its button)
 * disappears, a published page's button becomes disabled. For a few seconds after focus went back,
 * if that button goes away or is disabled while it still has focus, focus moves to `#main` instead
 * of falling to <body>.
 */
function keepFocusOnPage(el: HTMLElement) {
  const lost = () =>
    (!el.isConnected || el.matches(":disabled")) &&
    (document.activeElement === el ||
      document.activeElement === document.body ||
      document.activeElement === null);
  const observer = new MutationObserver(() => {
    if (!lost()) return;
    observer.disconnect();
    document.getElementById("main")?.focus({ preventScroll: true });
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled"],
  });
  window.setTimeout(() => observer.disconnect(), 5000);
}

const SIZE = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-2xl" } as const;

export function Dialog({
  title,
  description,
  role = "dialog",
  size = "sm",
  busy = false,
  dirty = false,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  /** Read with the title by screen readers (aria-describedby). */
  description?: ReactNode;
  /** "alertdialog" for confirmations of an action. */
  role?: "dialog" | "alertdialog";
  size?: keyof typeof SIZE;
  /** A request is running: Escape and the close button do nothing. */
  busy?: boolean;
  /** Unsaved input: Escape asks before it discards. */
  dirty?: boolean;
  /** Shows a close (×) button in the header with this name. */
  closeLabel?: string;
  onClose: () => void;
  /** <DialogBody> and <DialogFooter>, or a <DialogForm> holding them. */
  children: ReactNode;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    const first =
      dialog.querySelector<HTMLElement>("[data-autofocus]") ??
      focusableIn(dialog.querySelector<HTMLElement>("[data-dialog-body]") ?? dialog)[0] ??
      dialog;
    first.focus();

    // Escape is handled in onKeyDown; a close request the browser makes on its own (a second
    // Escape, a platform back gesture) must not close the dialog behind React's back.
    const onCancel = (e: Event) => e.preventDefault();
    const onNativeClose = () => {
      if (dialog.isConnected && !dialog.open) dialog.showModal();
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onNativeClose);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onNativeClose);
      if (dialog.open) dialog.close();
      root.style.overflow = overflow;
      // After the commit that closed the dialog: the opener may be re-enabled in the same render.
      queueMicrotask(() => {
        if (canTakeFocus(opener)) {
          opener.focus();
          keepFocusOnPage(opener);
        } else {
          document.getElementById("main")?.focus({ preventScroll: true });
        }
      });
    };
  }, []);

  function requestClose() {
    if (busy) return;
    if (dirty && !window.confirm(t("common.dialog.discard"))) return;
    onClose();
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDialogElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      requestClose();
      return;
    }
    trapTab(e, ref.current);
  }

  return (
    <dialog
      ref={ref}
      role={role}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy || undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cx(
        "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-hidden rounded-2xl border border-line bg-surface p-0 text-ink shadow-raised outline-none backdrop:bg-[#07121f]/55 open:flex open:flex-col",
        SIZE[size],
      )}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="break-words text-base font-semibold text-ink">
            {title}
          </h2>
          {description ? (
            <div id={descriptionId} className="break-words text-sm text-ink-2">
              {description}
            </div>
          ) : null}
        </div>
        {closeLabel ? (
          <button
            type="button"
            onClick={() => {
              if (!busy) onClose();
            }}
            disabled={busy}
            className={cx(buttonStyles.icon, "-mr-2 -mt-1 shrink-0")}
            aria-label={closeLabel}
          >
            <Icon name="close" size={18} />
          </button>
        ) : null}
      </div>
      {children}
    </dialog>
  );
}

/** The scrollable middle of a dialog. */
export function DialogBody({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div
      data-dialog-body=""
      className={cx("min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4", className)}
    >
      {children}
    </div>
  );
}

/** The action bar: right-aligned on wider screens, full-width buttons (primary on top) on phones. */
export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-line bg-surface-2/60 px-5 py-3 *:w-full sm:flex-row sm:items-center sm:justify-end sm:*:w-auto">
      {children}
    </div>
  );
}

/** A form spanning the body and the footer, so the footer's submit button belongs to it. */
export function DialogForm({
  children,
  onSubmit,
  label,
}: {
  children: ReactNode;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  label?: string;
}) {
  return (
    <form onSubmit={onSubmit} aria-label={label} className="flex min-h-0 flex-1 flex-col">
      {children}
    </form>
  );
}

/**
 * A yes/no confirmation. Focus starts on the cancel button (the safe choice); Enter on it cancels.
 */
export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  confirmAriaLabel,
  cancelLabel,
  danger = false,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  text?: string;
  confirmLabel: string;
  confirmAriaLabel?: string;
  cancelLabel: string;
  danger?: boolean;
  pending: boolean;
  /** Shown inside the dialog (role=alert) when the screen keeps the dialog open after a refusal. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      role="alertdialog"
      title={title}
      description={text ? <p className={danger ? "text-danger" : undefined}>{text}</p> : undefined}
      busy={pending}
      onClose={onCancel}
    >
      {error ? (
        <DialogBody>
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        </DialogBody>
      ) : null}
      <DialogFooter>
        <button
          type="button"
          data-autofocus=""
          onClick={onCancel}
          disabled={pending}
          className={buttonStyles.secondary}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          aria-label={confirmAriaLabel}
          className={danger ? buttonStyles.danger : buttonStyles.primary}
        >
          {pending ? <Spinner size={14} /> : null}
          <span>{confirmLabel}</span>
        </button>
      </DialogFooter>
    </Dialog>
  );
}
