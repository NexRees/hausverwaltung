# NexRees fork of HaVeWa

NexRees runs [HaVeWa](https://github.com/fgilde/hausverwaltung) (AGPL-3.0) as its property
management software under its own name and logo at `*.nexrees.de`. This file is the map of
what we changed, so every upstream merge stays quick.

## Rules

- **Open source.** This repository is public and everything in it is AGPL-3.0, including every
  NexRees change. Every change we run goes through this repository first: nothing is deployed
  from a private branch or a patched image. Users of the hosted service get the source of the
  exact running commit through the "Quellcode" link in the info drawer (`sourceUrlFor(APP_SHA)`,
  AGPL § 13). `NOTICE` states that this is a modified version (AGPL § 5a). Keep `LICENSE`,
  `LICENSING.md` and `NOTICE`; the branding guard test fails without them.
- **Small diff.** Product features (LLM, workflows, integrations) live outside this repo and
  talk to it through `/api/v1` and `/api/mcp`. Only patch HaVeWa where there is no other way.
- **Every patch is listed below** with its reason. A commit that touches a HaVeWa file starts
  with `nexrees:`; code comments at the patch say `nexrees:` too.
- **Name.** Never use "HaVeWa" as our product name; credit it as the base (info drawer, NOTICE).

## Branches

| Branch | What |
|---|---|
| `upstream` | Exact mirror of `fgilde/hausverwaltung` `main`; never edited by hand. Updated daily by `.github/workflows/nexrees-upstream-sync.yml`. |
| `sync/upstream-<date>-<sha>` | Created by the daily sync: `main` with upstream merged in, brand files kept, tests run. Opened as a pull request into `main`. |
| `main` | NexRees: upstream plus the patches below. Every push builds an image (`ghcr.io/nexrees/hausverwaltung:sha-<short>`) and deploys it to staging. |

## Patches to HaVeWa files

| Area | Files | Why |
|---|---|---|
| Name and links | `src/lib/brand.ts` (new), every visible "HaVeWa" in `src/`, `messages/*.json` (`app.name`, `about.*`, `welcomeTitle`) | NexRees product name; AGPL source link and upstream credit in the info drawer |
| Logo | `public/logo.png`, `public/icon.png`, `public/marketing/icon.png`, `src/app/icon.png`; removed `public/videos/estate-1.mp4` | NexRees mark from `NexRees/nexrees-brand`; the login video showed a HaVeWa sign, so the login panel falls back to the plain brand colour |
| Info drawer | `src/components/info-drawer.tsx` | Graphite header, NexRees website and issues, "Quellcode" link to the running commit, AGPL notice; HaVeWa docs and author credit kept |
| Login and setup screens | `src/app/[locale]/login/page.tsx`, `setup/page.tsx`, `src/components/brand-backdrop.tsx` (new) | Centred login card; always "NexRees" (not the tenant name); environment badge only top left; animated NexRees backdrop instead of the video: neural mesh plus an N that draws itself, scans and carries light pulses (pure CSS/SVG, respects reduced motion) |
| Environment badge | `src/components/env-badge.tsx` (new, + test), `(admin)/layout.tsx`, `portal/layout.tsx`, login | Shows "Staging" etc. from `APP_ENV`; nothing in production or when unset. Same image in every environment |
| Branding guard | `src/lib/brand.test.ts` (new) | Fails when "HaVeWa" shows up outside the credit, a logo changes, the login video returns, or the AGPL files go missing |
| Company sign-in | `src/lib/sso-provision.ts` (new, + test), `src/auth.ts` (signIn callback) | Upstream SSO only signs in existing users. With `SSO_AUTO_PROVISION_DOMAINS`, verified company accounts (Google Workspace: `hd` must match) get a user on first sign-in with `SSO_DEFAULT_ROLE` (never ADMIN or portal roles). Candidate to offer upstream. |
| Navigation | `(admin)/layout.tsx`, `portal/layout.tsx`, `src/components/app-sidebar.tsx`, `src/components/sidebar-account.tsx` (new), `src/components/page-title.tsx` (new), `src/components/info-drawer.tsx`, `src/components/user-menu.tsx` (exports `initials`), `src/lib/nav.ts`, `src/lib/nav-active.ts` (new, + test), `src/app/globals.css` | Top bar stays fixed while the page scrolls, with no rubber-band bounce at the page ends and a stable scrollbar gutter. Sidebar sections collapse: only the section of the current page is open and marked (dot, bar, `aria-current`); others open on click and close again on the next page. The account menu at the bottom of the sidebar holds settings, about (`info-drawer.tsx` can be opened from outside), language, theme, password, sign out, the version and the environment badge; Settings left the Admin section. The page title shows in the top bar (`page-title.tsx` mirrors the page's own `<h1>`, which `globals.css` hides together with a static list-page subtitle, so no upstream page file changes); search sits on the right |
| Merge rules | `.gitattributes` | `merge=ours` for logos, `brand.ts`, `NOTICE`, this file |
| Default tenant name | `prisma/bootstrap.ts` | "NexRees" instead of "HaVeWa" when `TENANT_NAME` is unset |
| Object storage | `src/lib/storage.ts`, `src/lib/storage-s3.test.ts`, `@aws-sdk/client-s3` | Documents in S3 when `STORAGE_S3_BUCKET` is set (tests: `storage-s3.test.ts`), so app containers need no shared disk. Local disk stays the default. Candidate to offer upstream. |
| Staff logins | `prisma/nexrees-users.ts` (new, + test) | Creates the logins in `NEXREES_USERS` on start; never resets existing users |
| CI | `.github/workflows/casaos-store.yml`, `pages.yml` | Run only in the upstream repo (they publish HaVeWa's store and site) |
| CI | `.github/workflows/docker-publish.yml` | Image name lowercased (`NexRees` owner; registry names must be lowercase) |
| CI (new) | `.github/workflows/nexrees-*.yml` | Daily upstream sync, staging deploy, promotion to production (same digest, approval) |
| Document preview | `src/components/document-preview.tsx`, `src/components/pdf-viewer.tsx` (new), `src/lib/preview-kind.ts` (new, + test), removed `src/app/api/documents/[id]/viewer/route.ts`, `pdfjs-dist` | Upstream loaded the Mudex viewer script from `mudex.org` at runtime, on our origin. Now pdf.js is bundled with the app (Apache-2.0): PDFs render in the browser, images/audio/video/text natively, Office files offer a download. No external requests. Candidate to offer upstream. |
| Betriebskostenabrechnung PDF | `src/lib/allocation/statement.ts` (`items` per cost, + test), `src/server/statements.ts`, `src/lib/statement-doc.ts` (new, + test), `src/server/statement-pdf.ts` (new, + test), `src/server/statement-letter.ts` (new), `src/app/api/statements/pdf` (new), `statement-actions.ts`, `(admin)/statements/page.tsx` | Upstream PDF was a one-page summary. Now a DIN 5008 letter (PDF/A-1b, multi-page) listing per cost type: total cost, allocation key, the tenant's share and amount, minus prepayments. Used by "An Mieter mailen" and a PDF link per row. Candidate to offer upstream. |
| Staff-only bulk data | `src/lib/staff-access.ts` (new, + test); `src/app/api/export/{persons,tenants,openitems,units,properties,tickets}`, `api/import-template`, `api/inbound-attachments`, `src/server/actions/ai.ts` | Upstream checked only "logged in": a tenant or owner could download every person with IBAN, and the AI actions sent the company summary for any user. Now ADMIN, VERWALTER, BUCHHALTUNG only (BEIRAT excluded too). Interim step of the access plan. Candidate to offer upstream |
| Data residency for AI | `src/lib/ai.ts`, `src/lib/ai-residency.ts` (new, + test), `src/lib/ai-bedrock.ts` (new), `server/actions/{ai,config}.ts`, `api-ops.ts`, `ai-assistant.tsx`, `explain-statement.tsx`, `settings-config.tsx`, `deploy/aws/modules/stack/app.tf` (`DATA_RESIDENCY`, Bedrock policy) | Upstream sent company data to the Anthropic/OpenAI APIs (USA). With `DATA_RESIDENCY` (Terraform sets the stack region) only AWS Bedrock in that region with in-region models, or gateways in `AI_ALLOWED_HOSTS`, are accepted, at save and at call time. Answers are labelled "KI-generiert" (AI Act Art. 50). Candidate to offer upstream |
| Credentials at rest | `src/lib/crypto.ts` (`openSecret`, production key check), `src/lib/secret-backfill.ts` (new, + test), `src/instrumentation.ts`, `config.ts`, `api-ops.ts`, `outbox.ts`, `notify.ts`, `inbound-sync.ts` | SMTP, IMAP and AI keys were stored in plain text; now AES-256-GCM like the bank keys. Old values are encrypted on start. Production refuses a weak `AUTH_SECRET`. Candidate to offer upstream |
| Password policy | `src/lib/password-policy.ts` (new, + test), `schemas.ts`, `actions/{users,account,tenants}.ts`, `messages/*.json` (`setup.passwordHint`) | 12+ characters, max 72 bytes (bcrypt), not common, not the e-mail. Upstream: 6 characters |
| Security headers | `next.config.ts` | HSTS, nosniff, frame/referrer/permissions policy, `frame-ancestors` CSP |
| Bookkeeping integrity (GoBD) | migration `20261109210000_nexrees_bookkeeping_integrity` (triggers), `prisma/schema.prisma` (Tenant `bookingsLockedUntil`, `sepaCreditor*`; SepaMandate `lastCollectedAt`; AuditLog `before`/`after`/`source`), `src/server/ledger.ts` (new, + test), `src/lib/audit.ts`, delete/create actions in `finances`, `costs`, `weg`, `leases`, `objects`, `statement-actions`, `tenants.ts`, `delete-button.tsx`, `bookkeeping-config.tsx` (new), settings page, `prisma/scale-seed.ts` (reset purges, loads booking rows in purge mode), `src/lib/bank-sync.ts`, `src/lib/bank-import.ts` (new, camt import shared by UI and API), `adapters/bankImport.ts` (entry reference), `persons.ts`, `niche.ts`, `src/server/bookkeeping.db.test.ts` (new, opt-in DB test) | Festschreibung per company by whole months, enforced in Postgres for every writer (UI, API, MCP, bank sync); bank sync and camt import skip and report closed-period transactions instead of stopping; full before/after journal of financial rows with the acting user; append-only audit log; a closed period cannot be reopened. Server actions return `{ error }` so the message survives production builds |
| Agent-ready writes | `src/lib/api-auth.ts` (`tokenId`, `tokenName`), `src/lib/api-write.ts`, `api/v1/operations/[op]`, `api/mcp` | Every generic API/MCP write runs in a transaction as the token's user with source `api:<token name>` and is audited; closed periods answer 409 with a readable message |
| SEPA direct debit | `src/lib/adapters/sepa.ts` (rewritten, + test), `src/lib/sepa-validate.ts` (new, + test), `api/export/sepa`, `mandateSchema` | Upstream files failed the pain.008 schema (no `ReqdColltnDt`, no `DtOfSgntr`) and used placeholder creditor data, always RCUR and one EndToEndId. Now validated creditor data, FRST/RCUR blocks, TARGET2 dates, DK character set with transliteration, mandate references checked not altered; only charges due in the 35 days before the collection date and without dunning are collected, net of credits; every file is recorded (`SepaCollection`, `charge-ledger.ts` `sepaDueByLease`) so no charge is debited twice; files are created by POST (`sepa-export.tsx`, finances page) and can be cancelled if not submitted |
| Tenancy-law rules | `src/lib/deposit.ts` (+ test), `src/lib/betrkv.ts` (new, + test), `leases.ts`, `costs.ts`, `statements.ts`, `statement-actions.ts`, `api-write.ts` | Deposit max. 3 net cold rents for flats (§ 551 Abs. 1 BGB) and interest compounding (§ 551 Abs. 3); management/maintenance costs never allocated (§ 1 Abs. 2 BetrKV); heating consumption share 50–100 % (HeizkostenV); no back-payment booking after the 12-month deadline (§ 556 Abs. 3 BGB), booked in the current month |
| End-to-end tests | `e2e/` (new), `playwright.config.ts` (new), `.github/workflows/nexrees-e2e.yml`, `nexrees-e2e-staging.yml` (new), `vitest.config.ts` (skips `e2e/` specs), `package.json` (`e2e*` scripts, `@playwright/test`) | Playwright drives the app as each role on every pull request: login, navigation, properties and units, Meine Arbeit, staff-only exports, BKA PDF. Read-only smoke test of staging after each deploy. See `e2e/README.md` |
| AWS | `deploy/aws/` (new) | Terraform for staging and production in AWS Frankfurt; safe deployment profile in its README |
| Scale (2,000+ units) | `src/lib/list-params.ts`, `src/components/list-filter.tsx`, `src/components/shared-options.tsx` (new); units, leases, persons, tickets, documents pages; `form-fields.tsx`, `lease-/ticket-/document-dialogs`, `payment-dialog-edit.tsx` | Lists are paged (50) with a search box; option lists (people, units, ...) go to the browser once instead of once per row. Before: these pages crashed the server at 2,000 units. See `docs/nexrees/scale-test.md` |
| Scale: open amounts | `src/server/charge-ledger.ts` (new, + test); finances, dunning, dashboard, reports pages; `bank-sync.ts`, `api-ops.ts`, `api-data.ts`, `export/openitems`, `actions/ai.ts`, `actions/finances.ts` | Paid/open/overdue per charge computed in Postgres instead of loading every charge with its payments (finances 11 s → 0.4 s). Bank/CAMT auto-matching now takes the oldest open charge first. Rent run inserts in one batch |
| Scale: background jobs | `prisma/schema.prisma` (`JobLease`), migration `20261109120000_nexrees_job_lease`, `src/lib/job-lease.ts` (new), the five `src/lib/*-scheduler.ts` | Only the instance holding the lease runs IMAP, bank, letter, outbox and notification jobs, so production can run 2+ app tasks. Candidate to offer upstream |
| Scale test data | `prisma/scale-seed.ts` (new) | Synthetic 2,000-unit tenant with 3 years of history for load tests; refuses production |
| Staging data pipeline | `.github/workflows/nexrees-staging-data.yml` (new), `prisma/seed-guard.ts` (new, + test), `deploy/aws/modules/stack/ci.tf` (`ci_can_run_tasks`) | One click loads (or removes) the test data into an existing staging company (`SCALE_TENANT`), as a one-off ECS task. Generated ids start with `sc`, so reset removes only them. Staging only. `nexrees-seed-check.yml` (new) runs seed/reset on every PR that touches `prisma/`, so the test data keeps up with schema changes |
| Team collaboration | `prisma/schema.prisma` (`Task` assignee/creator/record link, `Comment`, `AuditLog` index), migration `20261109200000_nexrees_collaboration`, `src/lib/collab.ts` (new, + test), `src/lib/access.ts` (new), `src/server/actions/collab.ts` (new), `src/server/collab-labels.ts` (new), `src/components/record-timeline.tsx`, `comment-composer.tsx`, `task-dialog.tsx` (new), `(admin)/my-work` (new), the four record pages (`properties`, `units`, `leases`, `persons` `[id]`: one line each), `src/lib/nav.ts`, `src/server/actions/maintenance.ts` (ticket hand-over notice), `messages/*.json` | Colleagues hand work to each other: tasks get an assignee and a link to a property, unit, lease or person; "Meine Arbeit" lists my tasks and tickets, mentions, what I handed over and unassigned tasks anyone can take (atomic, so two people cannot take the same one). Each record shows tasks, comments with @mentions and its change history in one card. Assigning, finishing and mentioning send in-app notifications. `access.ts` is the one place that decides who sees a record, ready for per-property access rules |

## Merging upstream

Every day at 05:17 UTC (or by hand: Actions → Upstream sync → Run workflow) the sync job:

1. mirrors HaVeWa into `upstream`;
2. merges it into a copy of `main`. Where both sides changed a brand file listed in
   `.gitattributes`, ours wins automatically;
3. runs the tests, including the branding guard;
4. opens a pull request into `main` saying whether tests passed;
5. if the merge was clean and the tests passed, merges it, which builds the image and deploys it
   to **staging**. Production is never updated automatically. Set the repository variable
   `UPSTREAM_AUTO_MERGE=false` to review every sync by hand instead.

One-time GitHub setting: Settings → Actions → General → "Allow GitHub Actions to create and
approve pull requests".

If the merge has conflicts, the pull request comes from `upstream` and lists the files. Merge
locally, keep upstream's change, re-apply ours (table above), `npm test`, push.

`merge=ours` only acts when both sides changed a file. A HaVeWa change to a file we never
touched (a new string with "HaVeWa", a new video) comes in silently; the branding guard catches
it and the pull request says "tests failing". Fix on the sync branch, then merge.

After merging: CI builds the image and deploys it to staging. Check staging, then promote the
same image tag to production.

Clone setup for local merges (once): `git config merge.ours.driver true`.

## Known follow-ups

- HaVeWa's in-app scheduler runs in every container. Keep one app task (`desired_count = 1`)
  until a second task runs with `HAVEWA_DISABLE_SCHEDULER=true`.
- `public/marketing/` (HaVeWa's own marketing page) is still served at `/marketing/`; only its
  `icon.png` is ours. Remove or replace it before customers see the domain.
- `npm ci` needs `--legacy-peer-deps` on npm 10 (upstream peer conflict next-auth / nodemailer);
  npm 11 in the Docker image installs without it.
