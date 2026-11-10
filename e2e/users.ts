// nexrees: the logins the E2E tests use. The demo seed (prisma/seed.ts) creates admin, Mieter and
// Eigentümer; e2e/seed.ts adds the two staff roles NexRees uses (Verwaltung, Buchhaltung).
// Test-only credentials for a throwaway database; never used anywhere else.
import type { UserRole } from "@prisma/client";

export type E2EUser = { key: string; email: string; password: string; name: string; role: UserRole; home: "dashboard" | "portal" };

export const USERS = {
  admin: { key: "admin", email: "admin@havewa.app", password: "admin", name: "Lena Hartmann", role: "ADMIN", home: "dashboard" },
  verwaltung: { key: "verwaltung", email: "verwaltung@nexrees.test", password: "e2e-verwaltung-pw", name: "Vera Verwaltung", role: "VERWALTER", home: "dashboard" },
  buchhaltung: { key: "buchhaltung", email: "buchhaltung@nexrees.test", password: "e2e-buchhaltung-pw", name: "Bernd Buchhaltung", role: "BUCHHALTUNG", home: "dashboard" },
  mieter: { key: "mieter", email: "mieter@havewa.app", password: "mieter", name: "Erika Mustermann", role: "MIETER", home: "portal" },
  eigentuemer: { key: "eigentuemer", email: "eigentuemer@havewa.app", password: "eigentuemer", name: "Klaus Eigner", role: "EIGENTUEMER", home: "portal" },
} as const satisfies Record<string, E2EUser>;

export type UserKey = keyof typeof USERS;
export const STAFF: UserKey[] = ["admin", "verwaltung", "buchhaltung"];
export const PORTAL: UserKey[] = ["mieter", "eigentuemer"];

/** Saved session (cookies) per role, written by e2e/auth.setup.ts. */
export const authFile = (key: UserKey) => `e2e/.auth/${key}.json`;
