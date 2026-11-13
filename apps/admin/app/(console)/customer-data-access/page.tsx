import { redirect } from "next/navigation";

/**
 * The DP-076 approval screen was retired by the DP-076 revision (ADR-017 v2): roles, lead access
 * included, are given directly under Staff and access.
 */
export default function CustomerDataAccessPage(): never {
  redirect("/staff");
}
