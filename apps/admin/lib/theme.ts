/**
 * Theme preference of the admin console: "light", "dark" or "system" (follow the OS).
 * The resolved theme is written to <html data-theme>; CSS tokens in app/globals.css follow it.
 * The preference is a display setting only and lives in localStorage, never in a cookie the
 * proxy would forward.
 */
export const THEME_STORAGE_KEY = "dp-admin-theme";
export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

export function parseThemePreference(value: unknown): ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value)
    ? (value as ThemePreference)
    : "system";
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/**
 * Runs inline in <head> before first paint. Kept tiny and dependency-free; any storage error
 * (private mode, blocked site data) falls back to the OS setting.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(p!=="light"&&p!=="dark")p=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=p}catch(e){document.documentElement.dataset.theme="light"}})();`;
