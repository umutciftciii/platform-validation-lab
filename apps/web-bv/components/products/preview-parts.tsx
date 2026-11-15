/**
 * DP-173 (ADR-022 D5): the parts only the company preview shows, around the shared catalogue
 * views: the banner, the review state on a card, the research proposal (apart from the current
 * texts) and the held/withheld values (never as specifications).
 */
import type {
  CatalogPreviewHeldValue,
  CatalogPreviewProductResponse,
  ProposalStatus,
} from "@dream/contracts";

export { previewLinks } from "./preview-links.ts";

const STATUS_TEXT: Record<ProposalStatus, string> = {
  REVIEW_PENDING: "Review pending",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved by the company",
};

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});

/** Fixed banner: this is a review copy, not the published site. */
export function PreviewBanner({ expiresAt }: { expiresAt: string }) {
  return (
    <div
      role="note"
      data-preview-banner=""
      className="relative z-30 -mx-4 mb-2 mt-4 rounded-xl border border-amber/40 bg-[#1b1406]/95 px-4 py-3 text-sm text-amber backdrop-blur sm:sticky sm:top-[72px] sm:mx-0"
    >
      <strong className="font-semibold">Preview — not published.</strong>{" "}
      <span className="text-glass/90">
        Dream Petroleum review copy of the catalogue: current site data with the proposed texts shown
        apart. Documents, enquiries and publication are switched off. Link valid until{" "}
        {TIME.format(new Date(expiresAt))}.
      </span>
    </div>
  );
}

/** The review state under a card's code (preview only). */
export function PreviewCardBadge({
  status,
  hasText,
  unpublished,
}: {
  status: ProposalStatus | null;
  hasText: boolean;
  unpublished: boolean;
}) {
  return (
    <p className="flex flex-wrap gap-1.5 text-[0.65rem] sm:text-xs" data-preview-badge="">
      {unpublished ? (
        <span className="rounded-full border border-glass/20 px-2 py-0.5 text-glass/80">Not published</span>
      ) : null}
      {status ? (
        <span className="rounded-full border border-amber/40 px-2 py-0.5 text-amber">
          {hasText ? "Proposed text" : "No text proposed"} · {STATUS_TEXT[status]}
        </span>
      ) : (
        <span className="rounded-full border border-glass/20 px-2 py-0.5 text-glass/80">No proposal</span>
      )}
    </p>
  );
}

/** The research proposal, apart from the product's current texts. */
export function ProposalBlock({ proposal }: { proposal: CatalogPreviewProductResponse["proposal"] }) {
  return (
    <section
      aria-labelledby="proposal"
      data-preview-proposal=""
      className="mt-8 rounded-2xl border border-amber/30 bg-amber/[0.05] px-5 py-5"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber">
        Research proposal — not published
      </p>
      <h2 id="proposal" className="sr-only">
        Research proposal
      </h2>
      {proposal && (proposal.summary || proposal.description) ? (
        <>
          <p className="mt-1 text-xs text-steel">
            {STATUS_TEXT[proposal.status]} · version {proposal.version}. Shown here for review; the
            product page above shows the current site texts.
          </p>
          {proposal.summary ? <p className="mt-3 text-glass">{proposal.summary}</p> : null}
          {proposal.description ? (
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[#cdd8e2]">
              {proposal.description}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-glass/90">
          {proposal
            ? "No text is proposed for this product: it awaits the company's confirmation."
            : "There is no research proposal for this product."}
        </p>
      )}
    </section>
  );
}

/** DP-002 held values and withheld rows: never product specifications. */
export function HeldBlock({ held }: { held: CatalogPreviewHeldValue[] }) {
  if (held.length === 0) return null;
  return (
    <section aria-labelledby="held" className="mt-12" data-preview-held="">
      <h2 id="held" className="text-xs font-semibold uppercase tracking-[0.12em] text-steel">
        Held for verification — not product data
      </h2>
      <p className="mt-2 text-sm text-steel">
        Values shown on the current site that were not imported: unverified or conflicting (DP-002),
        or without a test method or temperature. They are not specifications of this product.
      </p>
      <ul className="mt-3 divide-y divide-glass/10 border-y border-glass/10">
        {held.map((h, i) => (
          <li key={i} className="py-3">
            <p className="text-sm text-[#cdd8e2]">{h.raw}</p>
            <p className="mt-1 text-xs text-steel">
              {h.kind === "DP002_HELD" ? "Unverified (DP-002)" : "Not imported"}
              {h.conflict ? " · conflicting sources" : ""}
              {h.finding ? ` · ${h.finding}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Documents are not offered in the preview. */
export function NoDocumentsNote() {
  return (
    <p className="mt-12 text-xs text-steel" data-preview-no-documents="">
      Documents and enquiries are not available in the preview.
    </p>
  );
}

/** An expired, revoked or unknown link. */
export function PreviewUnavailable({ reason }: { reason: "not_found" | "unavailable" }) {
  return (
    <div className="rounded-2xl border border-glass/10 bg-glass/[0.03] px-6 py-14 text-center">
      <p className="text-lg font-medium text-glass">
        {reason === "not_found" ? "This preview link is not valid any more" : "The preview is not available right now"}
      </p>
      <p className="mx-auto mt-2 max-w-[48ch] text-sm text-steel">
        {reason === "not_found"
          ? "Preview links work for a short time and only while you are signed in to the admin console. Open a new link from the company review."
          : "Please try again in a moment."}
      </p>
    </div>
  );
}
