# Domain and compliance audit (2026-11-09)

Scope: `main@7284365` of NexRees/hausverwaltung, checked against German property-management law
(BGB Mietrecht, BetrKV, HeizkostenV, WEG), bookkeeping rules (GoBD), SEPA (EPC/DK), GDPR and the
EU AI Act, with "agent-ready" as a design goal. It builds on the compliance plan
(37 issues, see the project's "Legal & Compliance Readiness Plan") and the access-control plan; it
does not repeat those. **This is an engineering review, not legal advice.** Items marked
⚖️ need sign-off by the named adviser before real customer data.

## Fixed in this change

| Area | Finding on main | Now | Evidence |
|---|---|---|---|
| AI / data residency | `src/lib/ai.ts` sent company data to `api.anthropic.com` (USA) by default; any tenant admin could point it at any URL | AWS Bedrock provider (task role, no key). `DATA_RESIDENCY` refuses Anthropic/OpenAI public APIs, other Bedrock regions, cross-region inference profiles (`eu.`/`global.`/`us.` …, also as ARNs; application inference profiles are refused) and unlisted gateways, at save time and at call time. Terraform sets `DATA_RESIDENCY` to the stack region and grants `bedrock:InvokeModel` in that region only | `ai-residency.test.ts`; settings form shows the refusal (smoke test) |
| AI transparency | No marking of generated text | Every answer carries "KI-generiert · provider · model · bitte prüfen" (AI Act Art. 50) | `ai.ts` `aiSourceLabel` |
| Credentials | SMTP, IMAP and AI keys in plain text in `Tenant` | AES-256-GCM (existing `crypto.ts`), legacy values encrypted on start; production refuses a missing/weak `AUTH_SECRET`, including the placeholders in the repo's `.env` templates (the fallback key was public in the repo). A value that can no longer be decrypted reads as "not set" instead of crashing mail jobs | `crypto.test.ts`, `secret-backfill.test.ts` |
| Passwords | 6 characters minimum | 12+ chars, ≤ 72 bytes (bcrypt truncates), not common, not the e-mail; everywhere a password is set | `password-policy.test.ts` |
| HTTP headers | none | HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, CSP `frame-ancestors/object-src/base-uri` (not on the file downloads, which keep their own `sandbox` policy) | `curl -I` on a production build |
| GoBD: period close | Bookings editable and deletable forever | `Tenant.bookingsLockedUntil`, always a month end (charges are dated by month); Postgres triggers refuse INSERT/UPDATE/DELETE of Charge, Payment, ReserveTransaction dated on/before it, for every writer (UI, `/api/v1`, MCP, bank sync, cascades). Payment notes stay editable. The lock only moves forward. CostEntry (yearly statement input, prepared during the next year) is journaled, not locked. Bank sync and camt.053 import skip and report closed-period transactions instead of stopping; the camt import is one transaction with dedup | psql + Playwright: deleting a July charge after closing September → "Sollstellung vom 01.07.2026 liegt im festgeschriebenen Zeitraum …"; API → 409; `bookkeeping.db.test.ts` |
| GoBD: traceability | Hard deletes left no trace; audit log could be edited | Trigger journal writes the full before/after row for every UPDATE/DELETE of Charge, Payment, CostEntry, ReserveTransaction, Deposit, SepaMandate, with user and source (`ui`, `api:<token>`, `bank-sync`, `db`). All UI writers of these tables go through `bookAs`, so `db` only appears for direct database work. `AuditLog` is append-only (trigger) | `ledger.test.ts`; DB run shows `DELETE Charge ui "Lena Hartmann" before.amount=845.50` |
| SEPA | `pain.008` failed the XSD (no `ReqdColltnDt`, no `DtOfSgntr`), placeholder creditor ID `DE00ZZZ…` and IBAN `DE000…`, always RCUR, one EndToEndId for all, swept *all* arrears into the debit, every download debited again | Validated creditor ID/IBAN/BIC per company (settings → Buchhaltung), FRST/RCUR blocks, unique EndToEndIds, TARGET2 collection dates, DK character set with transliteration (Cyrillic/Greek/accents), mandate IBAN checksum and reference checked (never altered); collects only charges due in the 35 days before the collection date and not in dunning, net of the lease's credits and overpayments. Each file is recorded (`SepaCollection`), so a charge is never in two files; an unsubmitted file can be cancelled. Created by POST from Finanzen → Import/Export | Old file: `xmllint` fails ("Expected ReqdColltnDt"); new file validates against `pain.008.001.02.xsd`; `sepa.test.ts`, `bookkeeping.db.test.ts` |
| Deposit (§ 551 BGB) | No cap; simple interest | Flats: max. 3 × monthly rent without operating costs (Kaltmiete plus parking/modernisation/other rent parts), checked when a deposit is entered or its amount changes (form and API); interest compounds yearly (interest increases the deposit) | `deposit.test.ts` |
| BetrKV | Verwaltung/Instandhaltung could be marked "umlagefähig" and then appeared in tenant statements | Refused on input, and never allocated in the statement even for old rows (§ 1 Abs. 2 BetrKV) | `betrkv.test.ts` |
| HeizkostenV | Consumption share clamped 0–100 % | 50–100 % (§§ 7, 8; above 70 % only by agreement, § 10), for each position, the company default and old rows | `betrkv.test.ts` |
| BKA deadline | Back payments bookable any time, dated December of the statement year | After 31 Dec of the following year (§ 556 Abs. 3 BGB) only with the user's confirmation that the statement reached the tenants in time (or commercial space); the confirmation is in the audit log. Booked in the current month so a closed period stays closed | `betrkv.test.ts` |
| Agent-ready writes | API/MCP writes not audited; actor = user only | Every API/MCP write (generic and the special user, lease, resolution and agenda paths) is audited as `api:<token name>`, journaled where the table is; locked periods → 409 with a readable message; residency and domain rules apply to agents exactly as to people | API smoke test |

## Independent review of this change (2026-11-09)

A multi-agent review (bookkeeping triggers, actions/API, SEPA, tenancy law) confirmed 14 findings;
all are fixed in the second commit, with `src/server/bookkeeping.db.test.ts` (opt-in, needs a
migrated Postgres) covering the database side. The two serious ones: the period lock blocked the
bank sync of an account for good after a close (one closed-period transaction aborted every run),
and a second SEPA download debited the same charges again. Also fixed: credits were not netted in
the debit, duplicate renter rows doubled it, mandate references and non-Latin names were altered
or produced files the bank rejects, a mid-month close froze the current month, and several UI
writers were journaled without a user.

## Open findings (not changed here), by priority

1. **P0 Offboarding leaves data behind.** Deleting a company (`deleteTenant`) only cascades
   through relations; rows linked only by `tenantId` (e.g. charges without lease, audit log,
   e-mails) stay. Needs an explicit purge list and a deletion certificate (plan issue "Full customer
   data export and offboarding"). ⚖️ DSB: retention vs. deletion (GoBD 10 years vs. Art. 17 GDPR).
2. **P0 SEPA pre-notification and WEG Hausgeld.** The file is now technically valid, but the
   pre-notification (Vorabankündigung, 14 days unless agreed shorter) is a process step outside the
   software, and owners' Hausgeld is not collected (mandates only cover lease charges). A returned
   debit (Rücklastschrift) is not put into a new file automatically; it goes to dunning.
   ⚖️ Steuerberater/bank: agree pre-notification period in the mandate text.
3. **P1 Corrections after the close.** A closed period can only be corrected by a new booking in the
   open period; there is no "Storno" button yet that creates the counter-entry automatically.
   ⚖️ Steuerberater: confirm the close cadence (monthly vs. yearly) and the correction workflow.
4. **P1 Rent increases.** Only Staffel/Index adjustments exist. No § 558 BGB increase to the local
   comparative rent with the Kappungsgrenze (20 %/15 % in 3 years), no check of the 12-month rule
   for index rents (§ 557b Abs. 2), no Mietpreisbremse check for new leases (§ 556d).
5. **P1 Dunning fees.** Courts allow only actual costs (typically ≤ 2–3 € per reminder); the fee is
   free text. Default interest (§ 288 BGB, 5 pp above base rate) is not calculated.
6. **P1 Deposit instalments.** § 551 Abs. 2 BGB (three monthly instalments) is not modelled.
7. **P2 Script CSP.** Next.js inline scripts need nonces before a strict `script-src` is possible.
8. **P1 Journal and personal data.** The journal keeps before-images of SEPA mandates and
   deposits (IBAN, names) and is append-only, so an erasure request cannot remove them before the
   retention period ends. Needs a retention job (delete journal rows after 10 years, mandate data
   14 months after the last debit plus retention) in purge mode. ⚖️ DSB: retention periods.
9. **P2 Commercial leases.** Verwaltung/Instandhaltung are never allocated, also for commercial
   units where they can be agreed (safe side: never over-charges a tenant).
10. **P2 KMS for credentials.** Secrets are encrypted with a key derived from `AUTH_SECRET`; the plan
   targets KMS envelope encryption. Rotating `AUTH_SECRET` today makes stored credentials
   unreadable (re-enter them).

## Needs sign-off before real customers ⚖️

| Topic | Adviser |
|---|---|
| Betriebskostenabrechnung PDF content (PR #19) and the § 556 deadline wording | Mietrecht lawyer |
| Festschreibung cadence, correction workflow, Verfahrensdokumentation for the triggers | Steuerberater |
| AVV with AWS (Bedrock in eu-central-1), AI use in the record of processing, DSFA for AI features | DSB / IT lawyer |
| Choice of a Bedrock model actually offered **in-region** in eu-central-1 (otherwise AI stays off) | DSB + Abi |
| SEPA mandate text, pre-notification period | Bank / Steuerberater |

## Rollout notes

- Migration `20261109210000_nexrees_bookkeeping_integrity` adds columns and triggers only; no data
  is changed. Rollback: drop the triggers (`DROP TRIGGER nexrees_… ON "…"`), columns can stay.
- Staging: after deploy the AI assistant answers with a residency error until a Bedrock model with
  in-region availability is enabled in the account and set as `AI_MODEL` or in Settings → KI.
- Existing plaintext SMTP/IMAP/AI credentials are encrypted on the first start of the new image.
- Scale seed reset runs in purge mode, so the test data can still be removed after a close.
- Self-hosters: `AUTH_SECRET` must be at least 32 characters in production now and not a template placeholder.
- Rolling back to an image before this change: SMTP/IMAP/AI credentials are stored encrypted from
  the first start on, so they must be entered again after a rollback.
- SEPA files are now created by POST from Finanzen → Import/Export; the old download link returns 405.
- Staging: mandates loaded by an earlier scale seed have IBANs with wrong check digits, so the SEPA
  export refuses them until the seed is reset and loaded again (the seed now makes valid IBANs).

## How agents should use the API

Agents get their own API token (named after the agent, e.g. `agent-bka`), act with that token's
user role, and every write lands in the audit log as `api:<token name>` with the database journal
holding the before/after values. Rules that protect people protect agents' output too: closed
periods (409), deposit cap and BetrKV rules (422), data residency. `import_camt` returns
`skippedLocked` and `duplicates` next to `imported`. Per-agent permission subsets
are part of the access-control plan (phase 1+).
