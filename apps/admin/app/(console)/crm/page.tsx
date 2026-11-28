import { redirect } from "next/navigation";

/** CRM-1 (ADR-032): the CRM starts with its companies (a dashboard follows in CRM-5). */
export default function CrmPage(): never {
  redirect("/crm/companies");
}
