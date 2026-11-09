import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";

// nexrees: bulk-data routes must refuse portal roles and BEIRAT before touching the database.
const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; tenantId: string; role: UserRole } } }));
const dbCalls = vi.hoisted(() => ({ n: 0 }));

vi.mock("@/auth", () => ({ auth: async () => session.current }));
vi.mock("@/lib/acting-tenant", () => ({ actingTenantId: async (u: { tenantId: string }) => u.tenantId }));
vi.mock("@/lib/storage", () => ({ readFile: async () => Buffer.from("") }));
vi.mock("@/server/charge-ledger", () => ({ openCharges: async () => { dbCalls.n++; return []; } }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("@/lib/prisma", () => {
  const model = new Proxy({}, { get: (_t, op) => async () => { dbCalls.n++; return String(op).startsWith("findFirst") || String(op).startsWith("findUnique") ? null : []; } });
  return { prisma: new Proxy({}, { get: () => model }) };
});

import { isStaffRole } from "./staff-access";
import * as persons from "@/app/api/export/persons/route";
import * as tenants from "@/app/api/export/tenants/route";
import * as openitems from "@/app/api/export/openitems/route";
import * as units from "@/app/api/export/units/route";
import * as properties from "@/app/api/export/properties/route";
import * as tickets from "@/app/api/export/tickets/route";
import * as importTemplate from "@/app/api/import-template/[entity]/route";
import * as inboundAttachment from "@/app/api/inbound-attachments/[id]/route";

const req = new Request("http://x/") as never;
const routes: [string, () => Promise<Response>][] = [
  ["export/persons", () => persons.GET()],
  ["export/tenants", () => tenants.GET()],
  ["export/openitems", () => openitems.GET()],
  ["export/units", () => units.GET()],
  ["export/properties", () => properties.GET()],
  ["export/tickets", () => tickets.GET()],
  ["import-template", () => importTemplate.GET(req, { params: Promise.resolve({ entity: "unit" }) })],
  ["inbound-attachments", () => inboundAttachment.GET(req, { params: Promise.resolve({ id: "a1" }) })],
];

const BLOCKED: UserRole[] = ["MIETER", "EIGENTUEMER", "HANDWERKER", "BEIRAT"];
const STAFF: UserRole[] = ["ADMIN", "VERWALTER", "BUCHHALTUNG"];

describe("isStaffRole", () => {
  it("allows only management roles", () => {
    for (const r of STAFF) expect(isStaffRole(r)).toBe(true);
    for (const r of BLOCKED) expect(isStaffRole(r)).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });
});

describe("bulk-data routes", () => {
  beforeEach(() => { dbCalls.n = 0; });

  for (const [name, call] of routes) {
    it(`${name}: 401 without login`, async () => {
      session.current = null;
      expect((await call()).status).toBe(401);
    });
    for (const role of BLOCKED) {
      it(`${name}: 403 for ${role}, no database read`, async () => {
        session.current = { user: { id: "u1", tenantId: "t1", role } };
        expect((await call()).status).toBe(403);
        expect(dbCalls.n).toBe(0);
      });
    }
    it(`${name}: not refused for VERWALTER`, async () => {
      session.current = { user: { id: "u1", tenantId: "t1", role: "VERWALTER" } };
      expect([401, 403]).not.toContain((await call()).status);
    });
  }
});
