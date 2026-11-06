import { describe, expect, it } from "vitest";
import { ensureUsers, parseUsers } from "./nexrees-users";

const pw = "correct-horse-battery";

describe("parseUsers", () => {
  it("reads the staging logins and normalises e-mails", () => {
    const users = parseUsers(JSON.stringify([
      { email: "Admin@NexRees.de", name: "Admin", role: "ADMIN", password: pw },
      { email: "verwaltung@nexrees.de", name: "Verwaltung", role: "VERWALTER", password: pw },
      { email: "buchhaltung@nexrees.de", role: "BUCHHALTUNG", password: pw },
    ]));
    expect(users.map((u) => [u.email, u.role, u.name])).toEqual([
      ["admin@nexrees.de", "ADMIN", "Admin"],
      ["verwaltung@nexrees.de", "VERWALTER", "Verwaltung"],
      ["buchhaltung@nexrees.de", "BUCHHALTUNG", "buchhaltung@nexrees.de"],
    ]);
  });

  it("is empty when unset and refuses weak or malformed entries", () => {
    expect(parseUsers(undefined)).toEqual([]);
    expect(() => parseUsers('{"email":"a@b.de"}')).toThrow("JSON-Liste");
    expect(() => parseUsers('[{"email":"a@b.de","role":"ADMIN","password":"short"}]')).toThrow("12 Zeichen");
    expect(() => parseUsers(`[{"email":"a@b.de","role":"ROOT","password":"${pw}"}]`)).toThrow("Rolle");
  });
});

describe("ensureUsers", () => {
  it("creates only missing users in the first tenant and never touches existing ones", async () => {
    const existing = new Set(["admin@nexrees.de"]);
    const created: { email: string; tenantId: string; passwordHash: string }[] = [];
    const prisma = {
      tenant: { findFirst: async () => ({ id: "t1" }) },
      user: {
        findUnique: async ({ where }: { where: { email: string } }) => (existing.has(where.email) ? { id: "u" } : null),
        create: async ({ data }: { data: { email: string; tenantId: string; passwordHash: string } }) => {
          created.push(data);
          return data;
        },
      },
    };
    const wanted = parseUsers(JSON.stringify([
      { email: "admin@nexrees.de", role: "ADMIN", password: pw },
      { email: "verwaltung@nexrees.de", role: "VERWALTER", password: pw },
    ]));
    expect(await ensureUsers(prisma as never, wanted)).toEqual(["verwaltung@nexrees.de"]);
    expect(created[0].tenantId).toBe("t1");
    expect(created[0].passwordHash).not.toBe(pw);
  });

  it("fails clearly when bootstrap has not created a tenant yet", async () => {
    const prisma = { tenant: { findFirst: async () => null } };
    await expect(ensureUsers(prisma as never, parseUsers(`[{"email":"a@b.de","role":"ADMIN","password":"${pw}"}]`))).rejects.toThrow("kein Mandant");
  });
});
