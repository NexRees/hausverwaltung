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
| AI / data residency | `src/lib/ai.ts` sent company data to `api.anthropic.com` (USA) by default; any tenant admin could point it at any URL | AWS Bedrock provider (task role, no key). `DATA_RESIDENCY` refuses Anthropic/OpenAI public APIs, other Bedrock regions, cross-region inference profiles (`eu.`/`global.`/`us.` …) and unlisted gateways, at save time and at call time. Terraform sets `DATA_RESIDENCY` to the stack region and grants `bedrock:InvokeModel` in that region only | `ai-residency.test.ts`; settings form shows the refusal (smoke test) |
| AI transparency | No marking of generated text | Every answer carries "KI-generiert · provider · model · bitte prüfen" (AI Act Art. 50) | `ai.ts` `aiSourceLabel` |
| Credentials | SMTP, IMAP and AI keys in plain text in `Tenant` | AES-256-GCM (existing `crypto.ts`), legacy values encrypted on start; production refuses a missing/weak `AUTH_SECRET` (the fallback key was public in the repo) | `crypto.test.ts`, `secret-backfill.test.ts` |
| Passwords | 6 characters minimum | 12+ chars, ≤ 72 bytes (bcrypt truncates), not common, not the e-mail; everywhere a password is set | `password-policy.test.ts` |
| HTTP headers | none | HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, CSP `frame-ancestors/object-src/base-uri` | `curl -I` on a production build |
| GoBD: period close | Bookings editable and deletable forever | `Tenant.bookingsLockedUntil`; Postgres triggers refuse INSERT/UPDATE/DELETE of Charge, Payment, CostEntry, ReserveTransaction dated on/before it, for every writer (UI, `/api/v1`, MCP, bank sync, cascades). Payment notes stay editable. The lock only moves forward | psql + Playwright: deleting a July charge after closing September → "Sollstellung vom 01.07.2026 liegt im festgeschriebenen Zeitraum …"; API → 409 |
| GoBD: traceability | Hard deletes left no trace; audit log could be edited | Trigger journal writes the full before/after row for every UPDATE/DELETE of Charge, Payment, CostEntry, ReserveTransaction, Deposit, SepaMandate, with user and source (`ui`, `api:<token>`, `db`). `AuditLog` is append-only (trigger) | `ledger.test.ts`; DB run shows `DELETE Charge ui "Lena Hartmann" before.amount=845.50` |
| SEPA | `pain.008` failed the XSD (no `ReqdColltnDt`, no `DtOfSgntr`), placeholder creditor ID `DE00ZZZ…` and IBAN `DE000…`, always RCUR, one EndToEndId for all, swept *all* arrears into the debit | Validated creditor ID/IBAN/BIC per company (settings → Buchhaltung), FRST/RCUR blocks, unique EndToEndIds, TARGET2 collection dates, DK character set, mandate IBAN checksum; collects only charges due in the 35 days before the collection date and not in dunning | Old file: `xmllint` fails ("Expected ReqdColltnDt"); new file validates against `pain.008.001.02.xsd`; `sepa.test.ts` |
| Deposit (§ 551 BGB) | No cap; simple interest | Flats: max. 3 × Nettokaltmiete (form and API); interest compounds yearly (interest increases the deposit) | `deposit.test.ts` |
| BetrKV | Verwaltung/Instandhaltung could be marked "umlagefähig" and then appeared in tenant statements | Refused on input, and never allocated in the statement even for old rows (§ 1 Abs. 2 BetrKV) | `betrkv.test.ts` |
| HeizkostenV | Consumption share clamped 0–100 % | 50–100 % (§§ 7, 8; above 70 % only by agreement, § 10) | `betrkv.test.ts` |
| BKA deadline | Back payments bookable any time, dated December of the statement year | Refused after 31 Dec of the following year (§ 556 Abs. 3 BGB); booked in the current month so a closed year stays closed | `betrkv.test.ts` |
| Agent-ready writes | API/MCP writes not audited; actor = user only | Every generic API/MCP write is one transaction, journaled and audited as `api:<token name>`; locked periods → 409 with a readable message; residency and domain rules apply to agents exactly as to people | API smoke test |

## Open findings (not changed here), by priority

1. **P0 Offboarding leaves data behind.** Deleting a company (`deleteTenant`) only cascades
   through relations; rows linked only by `tenantId` (e.g. charges without lease, audit log,
   e-mails) stay. Needs an explicit purge list and a deletion certificate (plan issue "Full customer
   data export and offboarding"). ⚖️ DSB: retention vs. deletion (GoBD 10 years vs. Art. 17 GDPR).
2. **P0 SEPA pre-notification and WEG Hausgeld.** The file is now technically valid, but the
   pre-notification (Vorabankündigung, 14 days unless agreed shorter) is a process step outside the
   software, and owners' Hausgeld is not collected (mandates only cover lease charges).
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
8. **P2 KMS for credentials.** Secrets are encrypted with a key derived from `AUTH_SECRET`; the plan
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

- Migration `20261109200000_nexrees_bookkeeping_integrity` adds columns and triggers only; no data
  is changed. Rollback: drop the triggers (`DROP TRIGGER nexrees_… ON "…"`), columns can stay.
- Staging: after deploy the AI assistant answers with a residency error until a Bedrock model with
  in-region availability is enabled in the account and set as `AI_MODEL` or in Settings → KI.
- Existing plaintext SMTP/IMAP/AI credentials are encrypted on the first start of the new image.
- Scale seed reset runs in purge mode, so the test data can still be removed after a close.
- Self-hosters: `AUTH_SECRET` must be at least 32 characters in production now.

## How agents should use the API

Agents get their own API token (named after the agent, e.g. `agent-bka`), act with that token's
user role, and every write lands in the audit log as `api:<token name>` with the database journal
holding the before/after values. Rules that protect people protect agents' output too: closed
periods (409), deposit cap and BetrKV rules (422), data residency. Per-agent permission subsets
are part of the access-control plan (phase 1+).
