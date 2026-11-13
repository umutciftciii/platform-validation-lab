/**
 * The only way into the lead tables for the API (DP-103; ADR-012B, lead data).
 *
 * "Lead", "LeadDocumentRequest", "DocumentDownloadGrant" and "LeadDocumentDownload" have row-level
 * security for dp_app (migration 20261123090000_dp_103_lead_row_level_security): without a
 * context of the current transaction they show no row. `inLeadContext` opens ONE interactive
 * transaction, sets the context with `set_config(..., true)` (transaction-local: it ends with the
 * transaction, so nothing leaks to the next user of the pooled connection) and hands the callback
 * the usual site-scoped client of that transaction. The site scope stays the first line; RLS is
 * the second one, decided by the database:
 *
 *  - staff: the raw admin session token. The database hashes it, checks the session and finds
 *    the sites where the user holds `lead:read` (or is the system owner). A site id from the
 *    request never widens what the database opens.
 *  - public: the site of the proxy key plus the visitor's own key, the form's e-mail and/or the
 *    download token. Only rows of that e-mail or that token become visible.
 *
 * Any lead-table query outside `inLeadContext` sees nothing (fail closed) instead of failing
 * loudly; the integration tests cover every caller.
 */
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  siteScopedExtension,
  withoutRaw,
  type SiteScope,
  type SiteScopedClient,
} from "./site-scope.js";

export type LeadDataContext =
  | { kind: "staff"; sessionToken: string }
  | {
      kind: "public";
      siteId: string;
      /** Normalised e-mail of the submitted form: opens that lead and its requests. */
      leadEmail?: string | null;
      /** Raw download token: opens its grant, request and downloads. */
      grantToken?: string | null;
    };

export interface LeadTransactionOptions {
  /** Interactive transaction timeout in ms (Prisma default 5000). */
  timeout?: number;
}

export async function inLeadContext<T>(
  prisma: PrismaClient,
  scope: SiteScope,
  context: LeadDataContext,
  fn: (db: SiteScopedClient) => Promise<T>,
  options: LeadTransactionOptions = {},
): Promise<T> {
  const client = siteScopedExtension(prisma, scope);
  return client.$transaction(
    async (tx) => {
      if (context.kind === "staff") {
        await tx.$executeRaw`SELECT leads_rls_set_staff_context(${context.sessionToken})`;
      } else {
        await tx.$executeRaw`SELECT leads_rls_set_public_context(${context.siteId}::uuid,
          ${context.leadEmail ?? ""}, ${context.grantToken ?? ""})`;
      }
      return fn(withoutRaw(tx) as unknown as SiteScopedClient);
    },
    options.timeout ? { timeout: options.timeout } : undefined,
  );
}
