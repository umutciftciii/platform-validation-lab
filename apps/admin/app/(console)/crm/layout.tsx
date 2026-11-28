import type { ReactNode } from "react";
import { CrmNav } from "../../../components/crm/crm-nav";

/** CRM-3 (ADR-032 D11): every CRM page carries the section bar (overview, companies, people). */
export default function CrmLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6 sm:space-y-8">
      <CrmNav />
      {children}
    </div>
  );
}
