# Scale test: 2,000 units, 3 years of history

**Date:** 2026-11-09 · **Branch:** `claude/project-thread-tl7w6q` · **Data:** `prisma/scale-seed.ts`

## Dataset

**On staging:** Actions → "Staging data" → Run workflow (action `seed`, company `NexRees`). It loads
the data into that existing company in about 5 to 10 minutes; `reset` removes only the generated
rows (ids starting with `sc`), `reseed` does both. Locally: `SCALE_TENANT="NexRees"` with the
command below.

`SCALE_UNITS=2000 SCALE_YEARS=3 npx tsx prisma/scale-seed.ts` creates one tenant
("Scale Test Hausverwaltung", login `scale-admin@nexrees.test` / `SCALE_ADMIN_PASSWORD`, default
`scale-test`) in about 25 s. It refuses `APP_ENV=production` (and a production build without `APP_ENV`); `SCALE_RESET=1` removes it.

| What | Rows |
|---|---|
| Properties (rental + WEG) / buildings / units | 44 / 111 / 2,000 |
| People (owners, renters) / leases incl. history | 4,612 / 2,757 |
| Monthly charges / payments (in + out) / dunning notices | 56,871 / 60,581 / 3,730 |
| Meters / readings | 6,000 / 24,000 |
| Tickets / documents / emails / letters / audit log | 3,599 / 3,584 / 14,400 / 2,160 / 144,000 |
| Also | cost entries, WEG meetings, resolutions, plans, reserves, maintenance, insurance, property tax, appointments, tasks, SEPA mandates, notifications |

About 8 % of renters pay late, 1.5 % of rents stay unpaid (with dunning levels 1 to 3), so the
finance and dunning pages see realistic open items.

## Method

Production build (`next build && next start`), local Postgres 16, background jobs off. Each page
fetched 3 times while logged in as the scale admin, median time and HTML size recorded. The final
run used `NODE_OPTIONS=--max-old-space-size=512` to prove the app fits the 1 GB Fargate task.
Times are from a fast development machine; a 0.5 vCPU Fargate task will be slower, so treat them
as relative.

## Results

| Page | Before | After |
|---|---|---|
| Units | **> 120 s, server out of memory (2 GB heap)** | 0.13 s, 1.0 MB |
| Leases | 46 s, 12.5 MB | 0.14 s, 1.2 MB |
| People | 73 MB page, then crash | 0.06 s, 1.0 MB |
| Tickets | 48 MB page, then crash | 0.22 s, 2.1 MB |
| Documents | > 30 s, crash | 0.27 s, 3.3 MB |
| Finances | 11.4 s | 0.40 s |
| Dunning | 7.6 s | 0.26 s |
| Reports | 2.3 s | 0.23 s |
| Dashboard | 2.1 s | 0.22 s |
| All other 17 pages | 0.04 to 1.1 s | 0.04 to 0.7 s |
| Server memory after all pages | 2.4 GB RSS, crashed 4 times | 458 MB RSS (peak 515 MB) with a 512 MB heap cap |

## Causes and fixes

1. **Every row carried a full edit dialog with every option list.** The units page rendered one
   "new lease" dialog per vacant unit, each containing all 4,600 people; tickets rendered all
   2,000 units per row. The page grew with rows × options. Fix: option lists go to the browser once
   (`SharedOptionsProvider`), fields refer to them by name. People pickers got a quick filter.
2. **Lists had no paging.** Fix: units, leases, people, tickets and documents are paged (50 rows)
   with a search box; filters survive paging.
3. **Open amounts were computed in JavaScript over every charge and payment.** Finances, dunning,
   dashboard, reports, the open-items export, the API, the AI summary and bank auto-matching each
   loaded all ~57k charges with all payments. Fix: `src/server/charge-ledger.ts` computes
   paid/open/status in Postgres. A parity check over all 56,871 charges matched the old JS result
   exactly (2,918 open items, € 3,253,479.00 open, 0 mismatches).
4. **Background jobs would run on every instance.** Fix: `JobLease` row; only the holder runs the
   jobs, the others skip; a dead leader is replaced after 3 minutes. Production can now run 2+
   app tasks.
5. **Rent run inserted one charge per round trip.** Fix: one `createMany`.

## Not done yet (next steps)

- **Production sizing is unchanged** (`db.t4g.micro`, 0.5 vCPU / 1 GB, 1 task). Recommended before
  go-live with 2,000+ units: 2 app tasks (zero-downtime deploys, now safe) and `db.t4g.small`.
  That is a cost decision (budget is $150/month).
- ~~**Public API lists** (`/api/v1` charges, payments, persons...) still return everything.~~ Done
  ("Agent-ready API and MCP" in `NEXREES.md`): `?limit`/`?offset`/`?q` page them with
  `X-Total-Count` and `Link`; without parameters at most 5,000 rows (`X-Result-Truncated`).
  `/api/v1/charges` on this dataset: `?limit=5` 1.4 KB in 0.03-0.1 s; no parameters 5,000 rows,
  1.4 MB in 0.3-0.4 s (before: 56,871 rows, 7.3 MB, 3.3 s). MCP `list_charges`: 30 KB for the
  default 50 rows (before: 11.9 MB).
- **Pages still above 2 MB:** Zensus (5.8 MB), Documents (filter dropdowns list every unit and
  person), Finances. Fine at this size; switch to search-as-you-type pickers before 10,000 units.
- **Not covered by this test:** many users at once, PDF/letter generation at volume, IMAP and
  bank sync with real providers, S3 latency. A load test against staging (k6 or similar) is the
  next step once staging has the scale dataset.
- **Charge duplicates on a double-clicked rent run** were possible before and still are: there is
  no unique key per lease and month. Fixing it needs a data check on production first.
