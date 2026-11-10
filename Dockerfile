# HaVeWa — Produktions-Image (Next.js + Prisma)
FROM node:24-bookworm-slim AS base
WORKDIR /app
# openssl wird vom Prisma-Query-Engine benötigt; ghostscript wandelt Briefe mit
# Anlagen für die Deutsche Post nach PDF/A-1b um
RUN apt-get update && apt-get install -y --no-install-recommends openssl ghostscript \
    && rm -rf /var/lib/apt/lists/*

# --- Build ---
FROM base AS build
# Versions-Infos fürs UI (aus CI: run_number + commit-sha); .git ist nicht im Image.
ARG APP_BUILD
ARG APP_SHA
ENV APP_BUILD=$APP_BUILD APP_SHA=$APP_SHA
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
# nexrees: AGPL § 13 source archive of this commit (made by CI with git archive), served to
# signed-in users at /api/source. Local builds without it serve a notice instead.
RUN mkdir -p source && if [ -f source.tar.gz ]; then mv source.tar.gz source/; fi

# --- Runtime ---
FROM base AS runner
ENV NODE_ENV=production
# node_modules inkl. Prisma-CLI (für migrate deploy beim Start) übernehmen
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/messages ./messages
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
# src/ + tsconfig: der Seed (tsx prisma/seed.ts) importiert aus ../src/lib
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/source ./source

# Upload-Verzeichnis (per Volume gemountet)
RUN mkdir -p storage/documents

EXPOSE 3000
# Migrationen anwenden, optionalen Bootstrap (Demo-Seed / Admin aus Env) ausführen,
# dann Server starten.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/bootstrap.ts && npm start"]
