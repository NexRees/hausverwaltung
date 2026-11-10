# End-to-end UI tests (Playwright)

The tests drive the real app in Chromium as each role, against a database with known data.
They run on every pull request (`.github/workflows/nexrees-e2e.yml`, job "e2e").

## Run locally

```bash
docker compose up -d                       # Postgres on localhost:5432
export DATABASE_URL=postgresql://havewa:havewa@localhost:5432/havewa_e2e AUTH_SECRET=dev-only AUTH_TRUST_HOST=true
createdb -h localhost -U havewa havewa_e2e  # a separate, empty database
npm run e2e:seed                           # migrations + demo seed + staff logins (local DBs only)
npm run build
npx playwright install chromium            # once
npm run e2e                                # starts `next start` on :3100 and runs the tests
npx playwright test --ui                   # watch mode, step through a test
```

`npm run e2e:seed` never deletes anything. On a database that already holds the demo company
it only adds missing logins, so tests can run again; tests that create data use unique names.
It refuses any database that is not on localhost and `APP_ENV=staging|production`.

Already have a browser? `E2E_CHROMIUM_PATH=/path/to/chrome npm run e2e`.
Already have the app running (e.g. `npm run dev`)? Set `E2E_PORT` to its port; a running server
on that port is reused outside CI.

## Logins

`e2e/users.ts`: admin, Verwaltung (VERWALTER), Buchhaltung (BUCHHALTUNG), Mieter, Eigentümer.
`e2e/auth.setup.ts` signs each one in through the login form once; the specs reuse the session
with `test.use({ storageState: authFile("verwaltung") })`.

## What is covered

| Spec | Flow |
|---|---|
| `auth.setup.ts` | Login form for all five roles, wrong password refused |
| `tests/roles.spec.ts` | Staff land on the dashboard; Mieter/Eigentümer are kept in the portal; signed out goes to login |
| `tests/navigation.spec.ts` | Every sidebar page opens without server or browser errors and shows its title; current section/page marked |
| `tests/properties.spec.ts` | Seeded property with units, create a property, units search, unit detail |
| `tests/my-work.spec.ts` | Hand a task to a colleague who finishes it, take an unassigned task, @mention on a property |
| `tests/exports.spec.ts` | CSV exports: 403 for portal roles, 200 for staff, 401 signed out, export button downloads |
| `tests/statements.spec.ts` | Betriebskostenabrechnung 2025: PDF per lease is a real PDF; 403 for a tenant |
| `smoke/staging.spec.ts` | Read-only checks for a deployed environment (below) |

## Writing tests

- Find elements the way a user does: `getByRole`, `getByLabel`, visible German text. Add a
  `data-testid` only where there is no accessible name, and prefer fixing the name.
- The page title is the `<h1>` in the top bar: `pageTitle(page)` in `helpers.ts`. Pages keep
  their own `<h1>`, hidden by CSS.
- Create your own data with `uniq("…")`; never change or delete seeded records other tests read.
- `openPage()` fails on HTTP errors and error pages; `failOnPageErrors()` on uncaught browser errors.

## Staging smoke test

`.github/workflows/nexrees-e2e-staging.yml` runs `e2e/smoke` after every staging deploy. It only
reads. Setup: repository variable `STAGING_URL` (e.g. `https://staging.nexrees.de`), and in the
GitHub environment `staging` the secrets `E2E_SMOKE_EMAIL` / `E2E_SMOKE_PASSWORD` of a staff login.
By hand: `E2E_BASE_URL=https://staging.nexrees.de npm run e2e:smoke`.
