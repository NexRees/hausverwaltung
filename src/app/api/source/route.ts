// Copyright (c) 2026 NexRees. Part of the NexRees platform.
//
// nexrees: AGPL-3.0 § 13. The code is in a private repository, so the source of the running
// build is offered here instead of on GitHub: every signed-in user (staff, tenants, owners,
// tradespeople) can download it. CI packs the commit with `git archive` before the image build
// (docker-publish.yml) and the Dockerfile puts it in /app/source.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

const ARCHIVE = process.env.SOURCE_ARCHIVE_PATH || "source/source.tar.gz";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.redirect(new URL("/login", request.url), 303);

  const info = await stat(ARCHIVE).catch(() => null);
  if (!info?.isFile()) {
    return new Response(
      "Das Quellcode-Archiv fehlt in diesem Build. Bitte wende dich an die NexRees-Verwaltung.\n",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
  const sha = (process.env.APP_SHA || "").trim();
  const name = /^[0-9a-f]{7,40}$/i.test(sha) ? `nexrees-${sha.slice(0, 12)}.tar.gz` : "nexrees-source.tar.gz";
  return new Response(Readable.toWeb(createReadStream(ARCHIVE)) as ReadableStream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
