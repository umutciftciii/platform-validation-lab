"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useT } from "../i18n/locale-provider";
import { Icon } from "../icons";
import { cx } from "../ui";

/**
 * Save notifications of the product screens (PM-2). The provider sits above the forms, so a
 * notice survives the form's remount after `router.refresh()` (new version) instead of vanishing
 * with it. Notices stay 6 s, or until dismissed, in a polite live region.
 *
 * DP-187: a `NoticeScope` (one per product tab) names where the notice comes from, so a toast
 * says "Technical · Technical specifications saved." and offers a way back to that tab.
 */
type Tone = "success" | "error";
export interface NoticeOrigin {
  label: string;
  /** Shows the origin again (e.g. switches back to its tab); omitted when always visible. */
  open?: () => void;
}
interface Notice {
  id: number;
  tone: Tone;
  text: string;
  origin?: NoticeOrigin;
}
type Notify = (text: string, tone?: Tone) => void;
type NotifyFrom = (text: string, tone: Tone, origin?: NoticeOrigin) => void;

const NoticeContext = createContext<NotifyFrom | null>(null);
const ScopeContext = createContext<NoticeOrigin | null>(null);

/** The notifier of the surrounding provider, or null outside one. */
export function useNotice(): Notify | null {
  const notify = useContext(NoticeContext);
  const origin = useContext(ScopeContext);
  return useMemo(
    () =>
      notify
        ? (text: string, tone: Tone = "success") => notify(text, tone, origin ?? undefined)
        : null,
    [notify, origin],
  );
}

/** Names the origin of every notice raised below it (a tab of the product page). */
export function NoticeScope({ origin, children }: { origin: NoticeOrigin; children: ReactNode }) {
  return <ScopeContext.Provider value={origin}>{children}</ScopeContext.Provider>;
}

export function NoticeProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [notices, setNotices] = useState<Notice[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setNotices((list) => list.filter((n) => n.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const notify = useCallback<NotifyFrom>(
    (text, tone, origin) => {
      const id = ++seq.current;
      setNotices((list) => [...list.slice(-2), { id, tone, text, ...(origin ? { origin } : {}) }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), tone === "error" ? 9000 : 6000),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
    };
  }, []);

  return (
    <NoticeContext.Provider value={notify}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96"
      >
        {notices.map((n) => (
          <div
            key={n.id}
            role={n.tone === "error" ? "alert" : "status"}
            className={cx(
              "pointer-events-auto flex items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-raised ring-1 ring-inset",
              n.tone === "success"
                ? "bg-surface-raised text-ink ring-success/30"
                : "bg-danger-soft text-danger ring-danger/30",
            )}
          >
            <span
              className={cx(
                "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full",
                n.tone === "success" ? "bg-success-soft text-success" : "text-danger",
              )}
            >
              <Icon name={n.tone === "success" ? "check" : "alert"} size={14} />
            </span>
            <div className="min-w-0 flex-1">
              {n.origin ? (
                <p className="type-eyebrow mb-0.5 text-ink-3">
                  {n.origin.open ? (
                    <button
                      type="button"
                      onClick={n.origin.open}
                      className="underline-offset-2 hover:text-ink hover:underline"
                    >
                      {n.origin.label}
                    </button>
                  ) : (
                    n.origin.label
                  )}
                </p>
              ) : null}
              <p>{n.text}</p>
            </div>
            <button
              type="button"
              onClick={() => dismiss(n.id)}
              className="-m-1 rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              <Icon name="close" size={15} />
              <span className="sr-only">{t("catalog.list.notices.dismiss")}</span>
            </button>
          </div>
        ))}
      </div>
    </NoticeContext.Provider>
  );
}
