import type { StaffSessionResponse } from "@dream/contracts";
import { formatClock, relativeTime } from "../../lib/format";
import { Icon } from "../icons";
import { Panel, StatusPill } from "../ui";

/** Real data: the current staff session as the API reports it. Not sample data. */
export function SessionCard({ session, now }: { session: StaffSessionResponse; now: Date }) {
  const idle = new Date(session.idleExpiresAt);
  const absolute = new Date(session.absoluteExpiresAt);
  const stepUp = session.stepUpValidUntil ? new Date(session.stepUpValidUntil) : null;
  const stepUpFresh = stepUp !== null && stepUp.getTime() > now.getTime();

  return (
    <Panel id="session" title="Your session" bodyClassName="pt-1">
      <dl className="divide-y divide-line text-sm">
        <div className="flex items-center justify-between gap-3 py-3">
          <dt className="flex items-center gap-2 text-ink-2">
            <Icon name="shield" size={16} className="text-ink-3" />
            Second factor
          </dt>
          <dd>
            {session.mfaVerifiedAt ? (
              <StatusPill tone="success">Authenticator</StatusPill>
            ) : (
              <StatusPill tone="amber">Recovery code</StatusPill>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-3">
          <dt className="text-ink-2">Signs out when idle</dt>
          <dd className="tabular text-ink">
            <time dateTime={idle.toISOString()}>{relativeTime(idle, now)}</time>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-3">
          <dt className="text-ink-2">Session ends at</dt>
          <dd className="tabular text-ink">
            <time dateTime={absolute.toISOString()}>{formatClock(absolute)}</time>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-3">
          <dt className="text-ink-2">Sensitive actions</dt>
          <dd className="text-right text-ink">
            {stepUpFresh ? (
              <span className="tabular">Confirmed until {formatClock(stepUp)}</span>
            ) : (
              <span className="text-ink-3">Ask for a code</span>
            )}
          </dd>
        </div>
      </dl>
      {session.mfaVerifiedAt ? null : (
        <p className="mt-3 rounded-lg bg-amber-soft px-3 py-2.5 text-xs text-amber-ink">
          You signed in with a recovery code. Generate new recovery codes once you have your
          authenticator back.
        </p>
      )}
    </Panel>
  );
}
