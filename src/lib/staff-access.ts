import type { UserRole } from "@prisma/client";

// nexrees: roles that may read company-wide data in bulk (CSV exports, inbound mail,
// the AI assistant's company summary). Portal roles (MIETER, EIGENTUEMER, HANDWERKER)
// and BEIRAT (WEG advisory board, usually an owner) are excluded: upstream only checked
// "logged in", so any portal user could download e.g. every person with IBAN.
// Interim guard until record-level access (docs/nexrees access plan) replaces it.
export const STAFF_ROLES: readonly UserRole[] = ["ADMIN", "VERWALTER", "BUCHHALTUNG"];

export function isStaffRole(role: UserRole | null | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role);
}

export function forbidden(): Response {
  return new Response("Forbidden", { status: 403 });
}
