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
| Merge rules | `.gitattributes` | `merge=ours` for logos, `brand.ts`, `NOTICE`, this file |
| Default tenant name | `prisma/bootstrap.ts` | "NexRees" instead of "HaVeWa" when `TENANT_NAME` is unset |
| Object storage | `src/lib/storage.ts`, `src/lib/storage-s3.test.ts`, `@aws-sdk/client-s3` | Documents in S3 when `STORAGE_S3_BUCKET` is set (tests: `storage-s3.test.ts`), so app containers need no shared disk. Local disk stays the default. Candidate to offer upstream. |
| Staff logins | `prisma/nexrees-users.ts` (new, + test) | Creates the logins in `NEXREES_USERS` on start; never resets existing users |
| CI | `.github/workflows/casaos-store.yml`, `pages.yml` | Run only in the upstream repo (they publish HaVeWa's store and site) |
| CI | `.github/workflows/docker-publish.yml` | Image name lowercased (`NexRees` owner; registry names must be lowercase) |
| CI (new) | `.github/workflows/nexrees-*.yml` | Weekly upstream sync, staging deploy |
| AWS | `deploy/aws/` (new) | Terraform for staging and production in AWS Frankfurt |

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
