"use client";

import { useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Loader2, Check, Eye, EyeOff } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// nexrees: failed sign-ins are announced (role="alert") and focus returns to the password; a
// server or network error no longer leaves the button disabled; after signing in the user goes
// back to `callbackUrl` (validated by the login page) instead of always the dashboard.
type LoginError = "credentials" | "unavailable";

export function LoginForm({
  initialEmail = "",
  tenantName,
  ssoEnabled = false,
  ssoName = "SSO",
  callbackUrl,
}: {
  initialEmail?: string;
  tenantName?: string;
  ssoEnabled?: boolean;
  ssoName?: string;
  /** Same-origin path to open after signing in (already checked with safeCallbackPath). */
  callbackUrl?: string;
}) {
  const t = useTranslations("login");
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<LoginError | null>(null);
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  function fail(kind: LoginError) {
    setError(kind);
    // Let the alert render first, then put the user back where they fix it.
    requestAnimationFrame(() => {
      passwordRef.current?.focus();
      passwordRef.current?.select();
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    let signedIn = false;
    try {
      const res = await signIn("credentials", { email, password, redirect: false });
      if (res && !res.error && res.ok) signedIn = true;
      else fail(res?.error === "CredentialsSignin" ? "credentials" : "unavailable");
    } catch {
      fail("unavailable");
    } finally {
      if (!signedIn) setLoading(false);
    }
    if (signedIn) {
      setOk(true);
      setTimeout(() => {
        // callbackUrl already carries its locale, so it bypasses the locale-aware router.
        if (callbackUrl) window.location.assign(callbackUrl);
        else router.replace("/");
      }, 950);
    }
  }

  const errorId = error ? "login-error" : undefined;

  return (
    <>
      <form
        onSubmit={onSubmit}
        className={`space-y-4 transition-all duration-500 ${ok ? "-translate-x-6 opacity-0" : ""}`}
      >
        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            aria-invalid={error === "credentials" || undefined}
            aria-describedby={errorId}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{t("password")}</Label>
          <div className="relative">
            <Input
              ref={passwordRef}
              id="password"
              name="password"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="pr-10"
              aria-invalid={error === "credentials" || undefined}
              aria-describedby={errorId}
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("showPassword")}
              aria-pressed={showPw}
              aria-controls="password"
              title={t("showPassword")}
            >
              {showPw ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
          </div>
        </div>
        {error && (
          <p id="login-error" role="alert" className="text-sm font-medium text-destructive">
            {error === "credentials" ? t("error") : t("unavailable")}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={loading} aria-busy={loading || undefined}>
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t("submit")}
        </Button>
        {ssoEnabled && (
          <>
            <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />{t("or")}<span className="h-px flex-1 bg-border" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => signIn("oidc", { callbackUrl: callbackUrl ?? "/" })}
            >
              {t("ssoSubmit", { provider: ssoName })}
            </Button>
          </>
        )}
      </form>

      {/* Erfolgs-Animation */}
      {ok && (
        <div
          role="status"
          className="fixed inset-0 z-50 grid place-items-center bg-background/85 backdrop-blur-md animate-in fade-in duration-300"
        >
          <div className="flex flex-col items-center gap-4 duration-700 animate-in zoom-in-90 slide-in-from-bottom-4">
            <div className="grid size-16 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
              <Check className="size-8 animate-in zoom-in duration-500" aria-hidden />
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold">
                {t("welcome")}
                {tenantName ? `, ${tenantName}` : ""}
              </div>
              <div className="mt-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t("loadingApp")}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
