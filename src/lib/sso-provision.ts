// nexrees: company sign-in. Upstream SSO only signs in users that already exist. With
// SSO_AUTO_PROVISION_DOMAINS set, a person whose verified company account (for example
// Google Workspace @nexrees.de) is not yet a user gets one on first sign-in, with a safe
// default role in the company tenant. An admin can change the role afterwards.
//
// Security model:
// - Only verified e-mails (email_verified === true) on an exact listed domain.
// - With Google as issuer, the Workspace claim `hd` must match too, so a personal Google
//   account that merely uses a company address is refused.
// - ADMIN and the portal roles (MIETER, EIGENTUEMER) are never handed out automatically.
// - The user gets a random password nobody knows; they sign in through SSO only, unless
//   an admin sets a password.

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";

export const PROVISIONABLE_ROLES = ["VERWALTER", "BUCHHALTUNG", "BEIRAT", "HANDWERKER"] as const;
type ProvisionRole = (typeof PROVISIONABLE_ROLES)[number];

export type ProvisionPolicy = {
  domains: string[];
  role: ProvisionRole;
  tenantId?: string;
  requireHostedDomain: boolean;
};

/** Reads the policy from the environment; null = no automatic accounts (upstream behaviour). */
export function provisionPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): ProvisionPolicy | null {
  const domains = (env.SSO_AUTO_PROVISION_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  if (domains.length === 0) return null;
  for (const d of domains) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) throw new Error(`SSO_AUTO_PROVISION_DOMAINS: ungültige Domain "${d}"`);
  }
  const role = (env.SSO_DEFAULT_ROLE?.trim().toUpperCase() || "VERWALTER") as ProvisionRole;
  if (!PROVISIONABLE_ROLES.includes(role)) {
    throw new Error(`SSO_DEFAULT_ROLE: erlaubt sind ${PROVISIONABLE_ROLES.join(", ")} (nicht ${role})`);
  }
  const issuer = env.OIDC_ISSUER?.trim() ?? "";
  return {
    domains,
    role,
    tenantId: env.SSO_TENANT_ID?.trim() || undefined,
    requireHostedDomain: /^https:\/\/accounts\.google\.com\/?$/.test(issuer),
  };
}

export type SsoProfile = { email?: unknown; email_verified?: unknown; hd?: unknown; name?: unknown };

/** The normalised e-mail when this profile may get an account under the policy, else null. */
export function provisionableEmail(profile: SsoProfile | null | undefined, policy: ProvisionPolicy): string | null {
  if (!profile || profile.email_verified !== true || typeof profile.email !== "string") return null;
  const email = profile.email.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1 || email.indexOf("@") !== at) return null;
  const domain = email.slice(at + 1);
  if (!policy.domains.includes(domain)) return null;
  if (policy.requireHostedDomain && (typeof profile.hd !== "string" || profile.hd.toLowerCase() !== domain)) return null;
  return email;
}

type Db = {
  tenant: {
    findUnique(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null>;
    findFirst(args: { orderBy: { createdAt: "asc" }; select: { id: true } }): Promise<{ id: string } | null>;
  };
  user: {
    findFirst(args: { where: { email: { equals: string; mode: "insensitive" } }; select: { id: true } }): Promise<{ id: string } | null>;
    create(args: {
      data: { tenantId: string; email: string; name: string; role: UserRole; passwordHash: string };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
};

/**
 * Creates the user for a provisionable profile if it does not exist yet. Returns true when the
 * person may sign in. Safe under concurrent first sign-ins (unique e-mail).
 */
export async function provisionSsoUser(db: Db, profile: SsoProfile | null | undefined, policy: ProvisionPolicy): Promise<boolean> {
  const email = provisionableEmail(profile, policy);
  if (!email) return false;
  if (await db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } })) return true;

  const tenant = policy.tenantId
    ? await db.tenant.findUnique({ where: { id: policy.tenantId }, select: { id: true } })
    : await db.tenant.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!tenant) return false;

  const name = typeof profile?.name === "string" && profile.name.trim() ? profile.name.trim().slice(0, 120) : email;
  try {
    await db.user.create({
      data: {
        tenantId: tenant.id,
        email,
        name,
        role: policy.role,
        passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10),
      },
      select: { id: true },
    });
    console.info(`[sso] Benutzer angelegt: Rolle ${policy.role}, Domain ${email.split("@")[1]}`);
  } catch (e) {
    // Another first sign-in of the same person won the race: that user exists now.
    if ((e as { code?: string }).code !== "P2002") throw e;
  }
  return true;
}
