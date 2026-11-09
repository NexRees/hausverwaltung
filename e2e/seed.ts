// nexrees: known data for the E2E tests.
// Applies the migrations to the database in DATABASE_URL, loads the demo seed (prisma/seed.ts)
// into an empty database and adds the staff logins from e2e/users.ts. Never deletes anything:
// on a database that already holds the demo company it only adds missing logins, so it can run
// again. It still refuses anything that is not a local database, because the demo seed writes
// well-known passwords (admin/admin).
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { ensureUsers } from "../prisma/nexrees-users";
import { USERS } from "./users";

export function e2eSeedAllowed(env: { APP_ENV?: string; DATABASE_URL?: string }): string | null {
  if (env.APP_ENV === "production" || env.APP_ENV === "staging") return `APP_ENV=${env.APP_ENV}`;
  const url = env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return "DATABASE_URL fehlt oder ist ungültig";
  }
  if (!["localhost", "127.0.0.1", "::1", "db", "postgres"].includes(host)) return `Datenbank-Host ${host} ist nicht lokal`;
  return null;
}

async function main() {
  const refused = e2eSeedAllowed({ APP_ENV: process.env.APP_ENV, DATABASE_URL: process.env.DATABASE_URL });
  if (refused) {
    console.error(`[e2e-seed] abgelehnt: ${refused}. Nur für eine lokale Wegwerf-Datenbank.`);
    process.exit(1);
  }
  const run = (cmd: string) => execSync(cmd, { stdio: "inherit", env: process.env });
  run("npx prisma migrate deploy");
  const prisma = new PrismaClient();
  try {
    const tenants = await prisma.tenant.count();
    const demo = await prisma.user.findUnique({ where: { email: USERS.admin.email } });
    if (tenants === 0) run("npx tsx prisma/seed.ts");
    else if (!demo) throw new Error("Datenbank ist nicht leer und enthält keine Demo-Daten. Bitte eine leere Datenbank nehmen.");
    else console.log("[e2e-seed] Demo-Daten schon vorhanden, nur Logins prüfen.");
    const staff = [USERS.verwaltung, USERS.buchhaltung].map(({ email, name, role, password }) => ({ email, name, role, password }));
    const created = await ensureUsers(prisma, staff);
    console.log(`[e2e-seed] fertig, Staff-Logins angelegt: ${created.join(", ") || "keine"}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  main().catch((e) => {
    console.error("[e2e-seed]", e);
    process.exit(1);
  });
}
