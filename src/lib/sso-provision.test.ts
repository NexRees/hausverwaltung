import { describe, expect, it } from "vitest";
import { provisionPolicyFromEnv, provisionSsoUser, provisionableEmail, type ProvisionPolicy } from "./sso-provision";

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
const google: ProvisionPolicy = { domains: ["nexrees.de"], role: "VERWALTER", requireHostedDomain: true };
const ok = { email: "Lea.Neu@NexRees.de", email_verified: true, hd: "nexrees.de", name: "Lea Neu" };

describe("provisionPolicyFromEnv", () => {
  it("is off unless domains are set (upstream behaviour)", () => {
    expect(provisionPolicyFromEnv(env({}))).toBeNull();
    expect(provisionPolicyFromEnv(env({ SSO_AUTO_PROVISION_DOMAINS: " " }))).toBeNull();
  });

  it("reads domains, role and requires the Workspace claim for Google", () => {
    expect(
      provisionPolicyFromEnv(env({ SSO_AUTO_PROVISION_DOMAINS: "@NexRees.de, shams.holding", OIDC_ISSUER: "https://accounts.google.com" })),
    ).toEqual({ domains: ["nexrees.de", "shams.holding"], role: "VERWALTER", tenantId: undefined, requireHostedDomain: true });
    expect(provisionPolicyFromEnv(env({ SSO_AUTO_PROVISION_DOMAINS: "nexrees.de", SSO_DEFAULT_ROLE: "buchhaltung", OIDC_ISSUER: "https://id.example" })))
      .toMatchObject({ role: "BUCHHALTUNG", requireHostedDomain: false });
  });

  it("never hands out ADMIN or portal roles, and refuses malformed domains", () => {
    for (const r of ["ADMIN", "MIETER", "EIGENTUEMER"]) {
      expect(() => provisionPolicyFromEnv(env({ SSO_AUTO_PROVISION_DOMAINS: "nexrees.de", SSO_DEFAULT_ROLE: r }))).toThrow("SSO_DEFAULT_ROLE");
    }
    expect(() => provisionPolicyFromEnv(env({ SSO_AUTO_PROVISION_DOMAINS: "*" }))).toThrow("Domain");
  });
});

describe("provisionableEmail", () => {
  it("accepts a verified Workspace account and normalises the address", () => {
    expect(provisionableEmail(ok, google)).toBe("lea.neu@nexrees.de");
  });

  it.each([
    ["unverified", { ...ok, email_verified: false }],
    ["verified as a string", { ...ok, email_verified: "true" }],
    ["other domain", { ...ok, email: "lea@gmail.com", hd: undefined }],
    ["look-alike domain", { ...ok, email: "lea@nexrees.de.evil.com" }],
    ["subdomain", { ...ok, email: "lea@mail.nexrees.de" }],
    ["two @", { ...ok, email: "lea@evil.com@nexrees.de" }],
    ["personal Google account with a company address", { ...ok, hd: undefined }],
    ["other Workspace", { ...ok, hd: "evil.com" }],
    ["no e-mail", { email_verified: true, hd: "nexrees.de" }],
  ])("refuses %s", (_, profile) => {
    expect(provisionableEmail(profile, google)).toBeNull();
  });

  it("does not need hd for other identity providers", () => {
    expect(provisionableEmail({ ...ok, hd: undefined }, { ...google, requireHostedDomain: false })).toBe("lea.neu@nexrees.de");
  });
});

function fakeDb(opts: { existing?: string[]; tenant?: string | null; raceOnCreate?: boolean } = {}) {
  const created: { tenantId: string; email: string; name: string; role: string; passwordHash: string }[] = [];
  const db = {
    tenant: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === "t-custom" ? { id: "t-custom" } : null),
      findFirst: async () => (opts.tenant === null ? null : { id: opts.tenant ?? "t1" }),
    },
    user: {
      findFirst: async ({ where }: { where: { email: { equals: string } } }) =>
        opts.existing?.includes(where.email.equals) ? { id: "u" } : null,
      create: async ({ data }: { data: (typeof created)[number] }) => {
        if (opts.raceOnCreate) throw Object.assign(new Error("unique"), { code: "P2002" });
        created.push(data);
        return { id: "new" };
      },
    },
  };
  return { db, created };
}

describe("provisionSsoUser", () => {
  it("creates the user once with the default role in the first tenant and an unknown password", async () => {
    const { db, created } = fakeDb();
    expect(await provisionSsoUser(db, ok, google)).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ tenantId: "t1", email: "lea.neu@nexrees.de", name: "Lea Neu", role: "VERWALTER" });
    expect(created[0].passwordHash).toMatch(/^\$2[aby]\$10\$/);
  });

  it("does not create anything for an existing user or a refused profile", async () => {
    const a = fakeDb({ existing: ["lea.neu@nexrees.de"] });
    expect(await provisionSsoUser(a.db, ok, google)).toBe(true);
    expect(a.created).toHaveLength(0);
    const b = fakeDb();
    expect(await provisionSsoUser(b.db, { ...ok, hd: undefined }, google)).toBe(false);
    expect(b.created).toHaveLength(0);
  });

  it("uses SSO_TENANT_ID when set and refuses when the tenant is missing", async () => {
    const a = fakeDb();
    expect(await provisionSsoUser(a.db, ok, { ...google, tenantId: "t-custom" })).toBe(true);
    expect(a.created[0].tenantId).toBe("t-custom");
    expect(await provisionSsoUser(fakeDb().db, ok, { ...google, tenantId: "gone" })).toBe(false);
    expect(await provisionSsoUser(fakeDb({ tenant: null }).db, ok, google)).toBe(false);
  });

  it("treats a concurrent first sign-in as success", async () => {
    expect(await provisionSsoUser(fakeDb({ raceOnCreate: true }).db, ok, google)).toBe(true);
  });
});
