"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { outboxToast } from "@/components/outbox-toast";
import { Coins, Mail } from "lucide-react";
import { bookStatementCharges, emailStatementToTenants } from "@/server/actions/statement-actions";
import type { ActionState } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { backPaymentExcluded } from "@/lib/betrkv";

export function StatementActions({ propertyId, year }: { propertyId: string; year: number }) {
  const t = useTranslations("statements");
  const tRoot = useTranslations();
  const [bookState, book, booking] = useActionState<ActionState, FormData>(bookStatementCharges, {});
  const [mailState, mail, mailing] = useActionState<ActionState, FormData>(emailStatementToTenants, {});

  useEffect(() => {
    if (bookState.ok) toast.success(t("charged"));
    else if (bookState.error) toast.error(bookState.error);
  }, [bookState, t]);
  useEffect(() => {
    if (mailState.ok) outboxToast(tRoot, mailState.notice, t("mailed"));
    else if (mailState.error) toast.error(mailState.error);
  }, [mailState, t]);

  return (
    <div className="flex flex-wrap gap-2">
      <form
        action={book}
        onSubmit={(e) => {
          // nexrees: § 556 Abs. 3 BGB, after the deadline only with confirmed timely delivery
          const timely = e.currentTarget.elements.namedItem("confirmTimely") as HTMLInputElement;
          timely.value = "";
          if (!backPaymentExcluded(year, new Date())) return;
          if (window.confirm(tRoot("nexrees.statementLate.confirm", { year, deadline: `31.12.${year + 1}` }))) timely.value = "1";
          else e.preventDefault();
        }}
      >
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="year" value={year} />
        <input type="hidden" name="confirmTimely" defaultValue="" />
        <Button type="submit" size="sm" variant="outline" disabled={booking}>
          <Coins className="size-4" />
          {t("bookCharges")}
        </Button>
      </form>
      <form action={mail}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="year" value={year} />
        <Button type="submit" size="sm" variant="outline" disabled={mailing}>
          <Mail className="size-4" />
          {t("mailTenants")}
        </Button>
      </form>
    </div>
  );
}
