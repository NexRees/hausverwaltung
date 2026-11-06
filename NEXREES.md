# NexRees fork of HaVeWa

NexRees runs [HaVeWa](https://github.com/fgilde/hausverwaltung) (AGPL-3.0) as its property
management software under its own name and logo at `*.nexrees.de`. This file is the map of
what we changed, so every upstream merge stays quick.

## Rules

- **Open source.** Everything in this repository is AGPL-3.0. Users of the hosted service get
  the source of the exact running version through the "Quellcode" link in the info drawer
  (`BRAND.sourceUrl`, AGPL § 13). Keep `LICENSE`, `LICENSING.md` and `NOTICE`.
- **Small diff.** Product features (LLM, workflows, integrations) live outside this repo and
  talk to it through `/api/v1` and `/api/mcp`. Only patch HaVeWa where there is no other way.
- **Every patch is listed below** with its reason. A commit that touches a HaVeWa file starts
  with `nexrees:`; code comments at the patch say `nexrees:` too.
- **Name.** Never use "HaVeWa" as our product name; credit it as the base (info drawer, NOTICE).

## Branches

| Branch | What |
|---|---|
| `upstream` | Exact mirror of `fgilde/hausverwaltung` `main`; never edited by hand. Updated weekly by `.github/workflows/nexrees-upstream-sync.yml`, which opens a pull request into `main`. |
| `main` | NexRees: upstream plus the patches below. Every push builds an image (`ghcr.io/nexrees/hausverwaltung:sha-<short>`) and deploys it to staging. |

## Patches to HaVeWa files

| Area | Files | Why |
|---|---|---|
| Name and links | `src/lib/brand.ts` (new), every visible "HaVeWa" in `src/`, `messages/*.json` (`app.name`, `about.*`, `welcomeTitle`) | NexRees product name; AGPL source link and upstream credit in the info drawer |
| Logo | `public/logo.png`, `public/icon.png`, `public/marketing/icon.png`, `src/app/icon.png`; removed `public/videos/estate-1.mp4` | NexRees mark from `NexRees/nexrees-brand`; the login video showed a HaVeWa sign, so the login panel falls back to the plain brand colour |
| Info drawer | `src/components/info-drawer.tsx` | Graphite header, NexRees website and issues, "Quellcode" link, AGPL notice; HaVeWa docs and author credit kept |
| Default tenant name | `prisma/bootstrap.ts` | "NexRees" instead of "HaVeWa" when `TENANT_NAME` is unset |
| Object storage | `src/lib/storage.ts`, `src/lib/storage-s3.test.ts`, `@aws-sdk/client-s3` | Documents in S3 when `STORAGE_S3_BUCKET` is set (tests: `storage-s3.test.ts`), so app containers need no shared disk. Local disk stays the default. Candidate to offer upstream. |
| Staff logins | `prisma/nexrees-users.ts` (new, + test) | Creates the logins in `NEXREES_USERS` on start; never resets existing users |
| CI | `.github/workflows/casaos-store.yml`, `pages.yml` | Run only in the upstream repo (they publish HaVeWa's store and site) |
| CI (new) | `.github/workflows/nexrees-*.yml` | Weekly upstream sync, staging deploy |
| AWS | `deploy/aws/` (new) | Terraform for staging and production in AWS Frankfurt |

## Merging upstream

1. Review the weekly pull request `upstream` -> `main`.
2. Conflicts are almost always in the files above: keep upstream's change, then re-apply ours.
3. `npm test`, then merge: CI builds the image and deploys it to staging.
4. Check staging, then promote the same image tag to production.

## Known follow-ups

- HaVeWa's in-app scheduler runs in every container. Keep one app task (`desired_count = 1`)
  until a second task runs with `HAVEWA_DISABLE_SCHEDULER=true`.
- `public/marketing/` (HaVeWa's own marketing page) is still served at `/marketing/`; only its
  `icon.png` is ours. Remove or replace it before customers see the domain.
- `npm ci` needs `--legacy-peer-deps` on npm 10 (upstream peer conflict next-auth / nodemailer);
  npm 11 in the Docker image installs without it.
