"use client";

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
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-panel">
      <ErrorState title="This page could not be loaded" onRetry={reset}>
        The admin service did not answer as expected. Try again in a moment; if it keeps happening,
        give the reference below to the platform team.
        {error.digest ? (
          <span className="tabular mt-3 block text-xs text-ink-3">Reference {error.digest}</span>
        ) : null}
      </ErrorState>
    </div>
  );
}
