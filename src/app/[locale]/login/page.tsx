import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Check, ShieldCheck } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { needsSetup } from "@/lib/setup";
import { listBackgroundVideos } from "@/lib/videos";
import { BackgroundVideo } from "@/components/background-video";
import { LoginForm } from "@/components/login-form";
import { oidcConfigFromEnv } from "@/lib/sso";
import { APP_VERSION_LABEL, APP_VERSION_FULL } from "@/lib/version";
import { BRAND } from "@/lib/brand";
import { BrandBackdrop } from "@/components/brand-backdrop";
import { EnvBadge } from "@/components/env-badge";

export default async function LoginPage() {
  if (await needsSetup()) redirect("/setup");
  const session = await auth();
  if (session?.user) redirect("/");
  const t = await getTranslations();

  const tenant = await prisma.tenant.findFirst({
    orderBy: { createdAt: "asc" },
    select: { name: true, isDemo: true, logoKey: true },
  });
  // nexrees: the login is the NexRees product login, not one tenant's (several tenants share it).
  const tenantName = BRAND.name;
  const isDemo = tenant?.isDemo ?? false;
  const sso = oidcConfigFromEnv();
  // Eigenes Admin-Logo, sonst Produkt-Logo
  const logoUrl = "/logo.png";
  const videos = await listBackgroundVideos();

  const points = [t("login.point1"), t("login.point2"), t("login.point3")];
  const demo = [
    { role: "userRole.ADMIN", email: "admin@havewa.app", pw: "admin" },
    { role: "userRole.MIETER", email: "mieter@havewa.app", pw: "mieter" },
    { role: "userRole.EIGENTUEMER", email: "eigentuemer@havewa.app", pw: "eigentuemer" },
  ];

  return (
    <div className="grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      {/* Brand-Panel (Desktop) */}
      <div className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex">
        {videos.length > 0 ? (
          <BackgroundVideo sources={videos} className="absolute inset-0 -z-10" />
        ) : (
          <BrandBackdrop />
        )}
        {/* Legibilitäts-Overlays (nur über Video; der NexRees-Hintergrund bringt eigene mit) */}
        {videos.length > 0 && (
          <>
            <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/85 via-black/45 to-black/25" />
            <div className="absolute inset-0 -z-10 bg-primary/25 mix-blend-multiply" />
          </>
        )}

        <div className="nx-rise flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" className="size-10 rounded-xl ring-1 ring-white/20" />
          <div className="text-lg font-semibold tracking-tight">{BRAND.name}</div>
          <EnvBadge className="border-amber-300/40 bg-amber-300/15 text-amber-200 dark:text-amber-200" />
        </div>

        <div className="max-w-md space-y-6">
          <h2 className="nx-rise text-4xl font-semibold leading-tight tracking-tight" style={{ ["--nx-delay" as string]: "120ms" }}>
            {t("login.tagline")}
          </h2>
          <ul className="space-y-3 text-sm text-white/90">
            {points.map((p, i) => (
              <li key={i} className="nx-rise flex items-start gap-3" style={{ ["--nx-delay" as string]: `${260 + i * 120}ms` }}>
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-white/20">
                  <Check className="size-3.5" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-2 text-xs text-white/70">
          <ShieldCheck className="size-4" />
          © 2026 {t("app.name")} · DSGVO- &amp; GoBD-orientiert
        </div>

        {/* Produkt-Icon unten rechts im Video-Bereich */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/marketing/icon.png"
          alt={BRAND.name}
          className="pointer-events-none absolute bottom-6 right-6 h-20 w-auto object-contain opacity-90 drop-shadow-lg"
        />
      </div>

      {/* Formularseite */}
      <div className="relative flex items-center justify-center overflow-hidden bg-muted/30 p-6">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(60% 50% at 100% 0%, color-mix(in oklch, var(--primary) 12%, transparent) 0%, transparent 60%)",
          }}
        />
        <div className="nx-rise relative w-full max-w-sm space-y-8" style={{ ["--nx-delay" as string]: "80ms" }}>
          <div className="space-y-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt={tenantName} className="mx-auto h-44 w-auto object-contain" />
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("login.welcomeTo")} {tenantName}
            </h1>
            <p className="text-sm text-muted-foreground">{t("login.subtitle")}</p>
            <EnvBadge />
          </div>

          <LoginForm
            initialEmail={isDemo ? "admin@havewa.app" : ""}
            tenantName={tenantName}
            ssoEnabled={!!sso}
            ssoName={sso?.name ?? "SSO"}
          />

          {isDemo && (
            <div className="rounded-xl border bg-card/60 p-4 backdrop-blur">
              <p className="mb-3 text-xs font-medium text-muted-foreground">{t("login.demoTitle")}</p>
              <div className="space-y-2">
                {demo.map((d) => (
                  <div key={d.email} className="flex items-center justify-between gap-3 text-xs">
                    <span className="rounded bg-muted px-2 py-0.5 font-medium">{t(d.role)}</span>
                    <code className="text-muted-foreground">
                      {d.email} · {d.pw}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground" title={APP_VERSION_FULL}>
            {APP_VERSION_LABEL}
          </p>
        </div>
      </div>
    </div>
  );
}
