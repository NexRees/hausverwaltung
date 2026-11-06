import { PrismaClient, type UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

// nexrees: make sure the named staff logins exist (idempotent, runs after bootstrap.ts).
// NEXREES_USERS = JSON list, injected from AWS Secrets Manager by the ECS task:
//   [{"email":"admin@nexrees.de","name":"Admin","role":"ADMIN","password":"…"}, …]
// Creates missing users in the oldest tenant. Never changes an existing user or its password,
// so people can change their password in the app without it being reset on the next deploy.

const ROLES = ["ADMIN", "VERWALTER", "BUCHHALTUNG", "BEIRAT", "EIGENTUEMER", "MIETER", "HANDWERKER"] as const;

export type WantedUser = { email: string; name: string; role: UserRole; password: string };

export function parseUsers(raw: string | undefined): WantedUser[] {
  if (!raw?.trim()) return [];
  const list: unknown = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error("NEXREES_USERS muss eine JSON-Liste sein");
  return list.map((u, i) => {
    const { email, name, role, password } = (u ?? {}) as Record<string, unknown>;
    if (typeof email !== "string" || !email.includes("@")) throw new Error(`NEXREES_USERS[${i}]: email fehlt`);
    if (typeof password !== "string" || password.length < 12) throw new Error(`NEXREES_USERS[${i}]: Passwort unter 12 Zeichen`);
    if (!ROLES.includes(role as (typeof ROLES)[number])) throw new Error(`NEXREES_USERS[${i}]: unbekannte Rolle ${String(role)}`);
    return { email: email.trim().toLowerCase(), name: typeof name === "string" && name.trim() ? name.trim() : email, role: role as UserRole, password };
  });
}

export async function ensureUsers(prisma: PrismaClient, wanted: WantedUser[]): Promise<string[]> {
  if (!wanted.length) return [];
  const tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!tenant) throw new Error("kein Mandant vorhanden: erst bootstrap.ts (ADMIN_EMAIL/ADMIN_PASSWORD) ausführen");
  const created: string[] = [];
  for (const u of wanted) {
    if (await prisma.user.findUnique({ where: { email: u.email } })) continue;
    await prisma.user.create({
      data: { tenantId: tenant.id, email: u.email, name: u.name, role: u.role, passwordHash: await bcrypt.hash(u.password, 10) },
    });
    created.push(u.email);
  }
  return created;
}

async function main() {
  const wanted = parseUsers(process.env.NEXREES_USERS);
  if (!wanted.length) return;
  const prisma = new PrismaClient();
  try {
    const created = await ensureUsers(prisma, wanted);
    console.log(`[nexrees-users] ${created.length} angelegt, ${wanted.length - created.length} vorhanden.`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (process.argv[1]?.endsWith("nexrees-users.ts")) {
  main().catch((e) => {
    console.error("[nexrees-users] Fehler:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
