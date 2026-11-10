import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { PATHNAME_HEADER } from "./lib/safe-redirect";

const intlMiddleware = createMiddleware(routing);

// nexrees: tell server components which page was requested (path + query), so the login guard
// can send the user back there after signing in. Overwritten on every request the matcher covers;
// on skipped paths (API, files with a dot) a client could send it, so readers pass it through
// safeCallbackPath, which only accepts same-origin paths.
export default function middleware(request: NextRequest) {
  request.headers.set(PATHNAME_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|marketing|.*\\..*).*)"],
};
