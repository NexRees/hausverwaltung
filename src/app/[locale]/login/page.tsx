import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
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
import { LegalFooter } from "@/components/legal-footer";
import { safeCallbackPath } from "@/lib/safe-redirect";

// nexrees: Auth.js sends its errors here (pages.error in src/auth.ts); unknown codes get the generic text.
const AUTH_ERRORS: Record<string, string> = {
  AccessDenied: "login.authError.accessDenied",
  Configuration: "login.authError.configuration",
  CredentialsSignin: "login.error",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await needsSetup()) redirect("/setup");
  // nexrees: back to the page that asked for the login (same-origin paths only).
  const params = await searchParams;
  const callbackUrl = safeCallbackPath(params.callbackUrl) ?? undefined;
  const authError = typeof params.error === "string" ? params.error : undefined;
  const session = await auth();
  if (session?.user) redirect(callbackUrl ?? "/");
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
    <div className="relative flex min-h-svh flex-col items-center overflow-hidden p-4 sm:p-6">
      {videos.length > 0 ? (
        <>
          <BackgroundVideo sources={videos} className="absolute inset-0 -z-10" />
          <div className="absolute inset-0 -z-10 bg-black/60" />
        </>
      ) : (
        <BrandBackdrop />
      )}

      {/* Brand and environment, top left (the only environment badge on this page) */}
      {/* nexrees: the brand block is the page banner (all content inside landmarks) */}
      <header className="nx-rise absolute left-6 top-6 flex items-center gap-3 text-white sm:left-12 sm:top-12">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.png" alt="" className="size-10 rounded-xl ring-1 ring-white/20" />
        <div className="text-lg font-semibold tracking-tight">{BRAND.name}</div>
        <EnvBadge className="border-amber-300/40 bg-amber-300/15 text-amber-200 dark:text-amber-200" />
      </header>

      <main className="flex w-full flex-1 items-center justify-center py-16">
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

          {authError && (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t(AUTH_ERRORS[authError] ?? "login.authError.default")}
            </p>
          )}

          <LoginForm
            initialEmail={isDemo ? "admin@havewa.app" : ""}
            tenantName={tenantName}
            ssoEnabled={!!sso}
            ssoName={sso?.name ?? "SSO"}
            callbackUrl={callbackUrl}
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
      </main>

      {/* nexrees: Impressum, Datenschutz and AGPL source (translated; was a fixed German line) */}
      <LegalFooter tone="onDark" showCompliance />
    </div>
  );
}
