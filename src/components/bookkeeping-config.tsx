"use client";

// nexrees: Buchhaltung settings: period close (Festschreibung) and SEPA creditor data.

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Check, Lock, Landmark, TriangleAlert } from "lucide-react";
import { lockBookings, updateBookkeepingConfig } from "@/server/actions/config";
import type { ActionState } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Feedback({ state, okLabel }: { state: ActionState; okLabel: string }) {
  if (state.error)
    return (
      <span role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
        <TriangleAlert className="size-4" /> {state.error}
      </span>
    );
  if (state.ok)
    return (
      <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
        <Check className="size-4" /> {okLabel}
      </span>
    );
  return null;
}

export function BookkeepingConfig({
  lockedUntil,
  maxLock,
  sepa,
}: {
  lockedUntil: string | null; // YYYY-MM-DD
  maxLock: string; // YYYY-MM, previous month (computed on the server)
  sepa: { creditorId: string | null; iban: string | null; bic: string | null };
}) {
  const t = useTranslations("nexrees.bookkeeping");
  const [lockState, lockAction, locking] = useActionState<ActionState, FormData>(lockBookings, {});
  const [sepaState, sepaAction, saving] = useActionState<ActionState, FormData>(updateBookkeepingConfig, {});

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="size-4" /> {t("lockTitle")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("lockHint")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            {lockedUntil ? (
              <>
                {t("lockedUntil")}: <strong>{lockedUntil.split("-").reverse().join(".")}</strong>
              </>
            ) : (
              t("notLocked")
            )}
          </p>
          <form
            action={lockAction}
            className="space-y-4"
            onSubmit={(e) => {
              if (!window.confirm(t("lockConfirm"))) e.preventDefault();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="lockMonth">{t("lockUntil")}</Label>
              <Input id="lockMonth" name="lockMonth" type="month" max={maxLock} min={lockedUntil?.slice(0, 7)} required />
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" variant="destructive" disabled={locking}>
                {t("lockButton")}
              </Button>
              <Feedback state={lockState} okLabel={t("locked")} />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="size-4" /> {t("sepaTitle")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("sepaHint")}</p>
        </CardHeader>
        <CardContent>
          <form action={sepaAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sepaCreditorId">{t("creditorId")}</Label>
              <Input id="sepaCreditorId" name="sepaCreditorId" defaultValue={sepa.creditorId ?? ""} placeholder="DE98ZZZ09999999999" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sepaCreditorIban">{t("creditorIban")}</Label>
              <Input id="sepaCreditorIban" name="sepaCreditorIban" defaultValue={sepa.iban ?? ""} placeholder="DE89 3704 0044 0532 0130 00" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sepaCreditorBic">{t("creditorBic")}</Label>
              <Input id="sepaCreditorBic" name="sepaCreditorBic" defaultValue={sepa.bic ?? ""} />
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={saving}>
                {t("save")}
              </Button>
              <Feedback state={sepaState} okLabel={t("saved")} />
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
