import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
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
  const videos = await listBackgroundVideos();

  const demo = [
    { role: "userRole.ADMIN", email: "admin@havewa.app", pw: "admin" },
    { role: "userRole.MIETER", email: "mieter@havewa.app", pw: "mieter" },
    { role: "userRole.EIGENTUEMER", email: "eigentuemer@havewa.app", pw: "eigentuemer" },
  ];

  return (
    // nexrees: one centred login card over the animated NexRees backdrop.
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden p-4 sm:p-6">
      {videos.length > 0 ? (
        <>
          <BackgroundVideo sources={videos} className="absolute inset-0 -z-10" />
          <div className="absolute inset-0 -z-10 bg-black/60" />
        </>
      ) : (
        <BrandBackdrop />
      )}

      {/* Brand and environment, top left (the only environment badge on this page) */}
      <div className="nx-rise absolute left-6 top-6 flex items-center gap-3 text-white sm:left-12 sm:top-12">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.png" alt="" className="size-10 rounded-xl ring-1 ring-white/20" />
        <div className="text-lg font-semibold tracking-tight">{BRAND.name}</div>
        <EnvBadge className="border-amber-300/40 bg-amber-300/15 text-amber-200 dark:text-amber-200" />
      </div>

      <div
        className="nx-rise relative w-full max-w-sm space-y-6 rounded-2xl border border-white/15 bg-card/80 p-8 shadow-[0_30px_80px_-20px_rgba(0,0,0,.7),0_0_70px_-10px_rgba(70,110,255,.45)] ring-1 ring-white/10 backdrop-blur-2xl"
        style={{ ["--nx-delay" as string]: "900ms" }}
      >
        <div className="space-y-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt={tenantName} className="mx-auto size-14 rounded-2xl shadow-lg ring-1 ring-black/10" />
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("login.welcomeTo")} {tenantName}
          </h1>
          <p className="text-sm text-muted-foreground">{t("login.subtitle")}</p>
        </div>

        <LoginForm
          initialEmail={isDemo ? "admin@havewa.app" : ""}
          tenantName={tenantName}
          ssoEnabled={!!sso}
          ssoName={sso?.name ?? "SSO"}
        />

        {isDemo && (
          <div className="rounded-xl border bg-muted/40 p-4">
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

      <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-2 text-xs text-white/50">
        <ShieldCheck className="size-3.5" />© 2026 {BRAND.name} · DSGVO- &amp; GoBD-orientiert
      </div>
    </div>
  );
}
