// nexrees: the management company's contact details for the tenant portal, from the company
// settings (address and phone) and the sender address of its e-mails, as on its letters.

export type CompanyContact = {
  addressLines: string[];
  phone: string | null;
  /** `tel:` link target, digits and a leading "+" only. */
  phoneHref: string | null;
  email: string | null;
};

/** "+49 (0)30 123 45-6" → "tel:+4930123456"; null without digits. */
export function telHref(phone: string): string | null {
  const intl = phone.trim().startsWith("+");
  const digits = phone.replace(/\(0\)/g, intl ? "" : "0").replace(/\D/g, "");
  return digits.length >= 3 ? `tel:${intl ? "+" : ""}${digits}` : null;
}

/** Plain address from `"Name" <a@b.de>` or `a@b.de`; null for no-reply or invalid addresses. */
export function contactEmail(from: string | null | undefined): string | null {
  const raw = from ?? "";
  const addr = (/<([^<>]+)>/.exec(raw)?.[1] ?? raw).trim();
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(addr)) return null;
  return /^(?:no-?reply|do-?not-?reply|mailer-daemon)@/i.test(addr) ? null : addr;
}

export function companyContact(t: { address?: string | null; phone?: string | null; smtpFrom?: string | null }): CompanyContact {
  const addressLines = (t.address ?? "")
    .split(/\r?\n|,\s*/)
    .map((l) => l.trim())
    .filter(Boolean);
  const phone = t.phone?.trim() || null;
  return { addressLines, phone, phoneHref: phone ? telHref(phone) : null, email: contactEmail(t.smtpFrom) };
}
