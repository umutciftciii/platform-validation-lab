/**
 * Lead sales workflow from the browser (DP-041; ADR-019), through the admin's same-origin proxy.
 * The API decides every change (lead:manage on the lead's site, transitions, assignee); the
 * database checks the same again. Error rules map to messages in staff-client RULE_MESSAGES.
 */
import type {
  LeadActivityInput,
  LeadActivityResponse,
  LeadWorkflowInput,
  LeadWorkflowResponse,
} from "@dream/contracts";
import { postJson } from "./staff-client";

const base = (leadId: string) => `/api/v1/admin/leads/${encodeURIComponent(leadId)}`;

export const changeLeadWorkflow = (leadId: string, body: LeadWorkflowInput) =>
  postJson<LeadWorkflowResponse>(`${base(leadId)}/workflow`, body);

export const addLeadActivity = (leadId: string, body: LeadActivityInput) =>
  postJson<LeadActivityResponse>(`${base(leadId)}/activities`, body);

/** `<input type="datetime-local">` value (local time) → ISO instant; null when empty or invalid. */
export function localDateTimeToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The current local time as a `datetime-local` value (minutes). */
export function nowLocalDateTime(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}`;
}
