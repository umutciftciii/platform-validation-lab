/**
 * God Mode module switches (F1-001, DP-071). God Mode manages optional modules per site; it can
 * never disable a core module (MFA, audit, RBAC and the standard product core). The database
 * enforces the same rule with a trigger. Disabling a module stops access to it; it never deletes
 * data (K-03).
 */
import { MODULE_BY_KEY } from "./catalog.js";

export type ModuleChangeProblem = "unknown_module" | "core_module" | "reason_required";

export interface ModuleChange {
  moduleKey: string;
  enabled: boolean;
  reason: string;
}

export function moduleChangeProblem(change: ModuleChange): ModuleChangeProblem | null {
  const mod = MODULE_BY_KEY.get(change.moduleKey);
  if (!mod) return "unknown_module";
  if (mod.isCore && !change.enabled) return "core_module";
  if (!change.reason.trim()) return "reason_required";
  return null;
}
