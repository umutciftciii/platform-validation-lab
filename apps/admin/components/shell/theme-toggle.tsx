"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "../../lib/theme";
import { Icon, type IconKey } from "../icons";
import { cx } from "../ui";

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: IconKey }> = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "Match system", icon: "monitor" },
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

/** Three-way segmented control: light, dark, follow the OS. */
export function ThemeToggle({ className }: { className?: string }) {
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
      aria-label="Colour theme"
      className={cx("inline-flex rounded-lg border border-line bg-surface-2 p-0.5", className)}
    >
      {OPTIONS.map((o) => {
        const checked = preference === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.label}
            title={o.label}
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
