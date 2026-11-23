"use client";

import { useT } from "../../components/i18n/locale-provider";
import { ErrorState } from "../../components/ui";

/**
 * Console error boundary. Most often the API could not confirm the session (unreachable or an
 * unexpected answer); nothing is shown from the failed render. The digest is the server log key.
 */
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-panel">
      <ErrorState title={t("errorPage.title")} onRetry={reset}>
        {t("errorPage.text")}
        {error.digest ? (
          <span className="tabular mt-3 block text-xs text-ink-3">
            {t("errorPage.reference", { digest: error.digest })}
          </span>
        ) : null}
      </ErrorState>
    </div>
  );
}
