"use client";

import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import {
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "../../lib/theme";
import { radioKeyTarget } from "../../lib/radio-keys";
import { Icon, type IconKey } from "../icons";
import { useT } from "../i18n/locale-provider";
import { cx } from "../ui";

const OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  label: "theme.light" | "theme.dark" | "theme.system";
  icon: IconKey;
}> = [
  { value: "light", label: "theme.light", icon: "sun" },
  { value: "dark", label: "theme.dark", icon: "moon" },
  { value: "system", label: "theme.system", icon: "monitor" },
];

const CHANGE_EVENT = "dp-admin-theme-change";

function readStored(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function apply(preference: ThemePreference) {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = resolveTheme(preference, dark);
}

/**
 * Three-way segmented control: light, dark, follow the OS.
 *
 * DP-273: a real ARIA radio group, like the language switch (DP-269). It is one Tab stop: the
 * checked option, or the first one before the stored preference is read (server render and first
 * paint). ArrowLeft/ArrowUp and ArrowRight/ArrowDown move to the previous/next theme and pick it
 * (wrapping), Home and End pick the first and last; Enter or Space on the focused option picks it
 * as before. The theme itself, its localStorage key and the server HTML's selection are unchanged.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useT();
  // null on the server: no option is shown as selected until the browser store is read.
  const preference = useSyncExternalStore<ThemePreference | null>(
    subscribe,
    readStored,
    () => null,
  );

  useEffect(() => {
    if (preference === null) return;
    apply(preference);
    if (preference !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const checkedIndex = OPTIONS.findIndex((o) => o.value === preference);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const from = options.current.indexOf(e.target as HTMLButtonElement);
    const to = radioKeyTarget(e.key, from, OPTIONS.length);
    if (to === null) return;
    e.preventDefault();
    const option = OPTIONS[to];
    if (!option) return;
    options.current[to]?.focus();
    if (option.value !== preference) choose(option.value);
  }

  function choose(value: ThemePreference) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch {
      // Storage blocked: the choice still applies for this page view.
    }
    apply(value);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <div
      role="radiogroup"
      aria-label={t("theme.label")}
      onKeyDown={onKeyDown}
      className={cx("inline-flex rounded-lg border border-line bg-surface-2 p-0.5", className)}
    >
      {OPTIONS.map((o, i) => {
        const checked = preference === o.value;
        const tabStop = checkedIndex < 0 ? i === 0 : checked;
        return (
          <button
            key={o.value}
            ref={(el) => {
              options.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={t(o.label)}
            title={t(o.label)}
            tabIndex={tabStop ? 0 : -1}
            onClick={() => choose(o.value)}
            className={cx(
              "inline-flex size-7 items-center justify-center rounded-md transition-colors duration-150",
              checked
                ? "bg-surface text-ink shadow-sm ring-1 ring-line-strong"
                : "text-ink-3 hover:text-ink",
            )}
          >
            <Icon name={o.icon} size={16} />
          </button>
        );
      })}
    </div>
  );
}
