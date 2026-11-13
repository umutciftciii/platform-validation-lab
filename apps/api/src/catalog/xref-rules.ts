/**
 * Pure rules of product cross-references (PM-6, ADR-015), shared by the admin and the public
 * service and unit-tested on their own.
 *
 * A verification records what it was based on. It holds ("current") only while all of these are
 * unchanged: the source revision is still the active revision of an active document, the
 * product's specification values have the same fingerprint, the global product has the same
 * version, and the global product and its brand are active. Otherwise it is "stale": the public
 * sites stop showing the relation (fail-closed; never kept as VERIFIED, never downgraded to
 * SIMILAR without a person deciding so).
 */
import { createHash } from "node:crypto";
import type {
  CrossReferenceSiteState,
  CrossReferenceStatus,
  VerificationStaleReason,
  VerificationState,
} from "@dream/contracts";

type Dec = { toString(): string } | null;

export interface SpecValueFact {
  key: string;
  numberValue: Dec;
  rangeMin: Dec;
  rangeMax: Dec;
  textValue: string | null;
  booleanValue: boolean | null;
  unit: string | null;
  testMethod: string | null;
}

const dec = (d: Dec) => (d === null ? null : d.toString());

/**
 * sha256 over the product's specification values, ordered by definition key. Any change of a
 * value, unit or test method, or a value added or removed, changes the fingerprint.
 */
export function specFingerprint(values: readonly SpecValueFact[]): string {
  const rows = [...values]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((v) => [
      v.key,
      dec(v.numberValue),
      dec(v.rangeMin),
      dec(v.rangeMax),
      v.textValue,
      v.booleanValue,
      v.unit,
      v.testMethod,
    ]);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export interface VerificationFacts {
  status: CrossReferenceStatus;
  /** The named source revision is the document's active revision. */
  sourceRevisionActive: boolean | null;
  /** The source document is ACTIVE (not archived). */
  sourceDocumentActive: boolean | null;
  verifiedSpecHash: string | null;
  currentSpecHash: string;
  verifiedGlobalVersion: number | null;
  globalVersion: number;
  /** Global product and brand are ACTIVE. */
  globalActive: boolean;
}

export function staleReasons(f: VerificationFacts): VerificationStaleReason[] {
  if (f.status !== "VERIFIED" && f.status !== "PENDING_VERIFICATION") return [];
  const out: VerificationStaleReason[] = [];
  if (f.sourceRevisionActive !== true) out.push("source_revision_replaced");
  if (f.sourceDocumentActive !== true) out.push("source_document_archived");
  if (f.status === "VERIFIED") {
    if (f.verifiedSpecHash !== f.currentSpecHash) out.push("specs_changed");
    if (f.verifiedGlobalVersion !== f.globalVersion) out.push("global_product_changed");
  }
  if (!f.globalActive) out.push("global_product_archived");
  return out;
}

export function verificationState(f: VerificationFacts): VerificationState {
  if (f.status === "PENDING_VERIFICATION") return "pending";
  if (f.status !== "VERIFIED") return "none";
  return staleReasons(f).length === 0 ? "current" : "stale";
}

/**
 * What a public site may show for a relation, before the site switch and the product's
 * publication are considered: VERIFIED only while the verification is current; a pending request
 * is still a SIMILAR relation; removed, archived and stale relations show nothing.
 */
export function publicRelation(f: VerificationFacts): "SIMILAR" | "VERIFIED" | null {
  if (f.status === "REMOVED" || !f.globalActive) return null;
  if (f.status === "VERIFIED") return verificationState(f) === "current" ? "VERIFIED" : null;
  return "SIMILAR";
}

export function crossReferenceSiteState(input: {
  facts: VerificationFacts;
  enabled: boolean;
  productLive: boolean;
}): { state: CrossReferenceSiteState; shownAs: "SIMILAR" | "VERIFIED" | null } {
  const relation = publicRelation(input.facts);
  if (input.facts.status === "REMOVED" || !input.facts.globalActive) {
    return { state: "not_publishable", shownAs: null };
  }
  if (relation === null) return { state: "verification_stale", shownAs: null };
  if (!input.enabled) return { state: "hidden", shownAs: null };
  if (!input.productLive) return { state: "product_not_live", shownAs: null };
  return { state: "shown", shownAs: relation };
}
