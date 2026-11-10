import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { PATHNAME_HEADER } from "./lib/safe-redirect";

const intlMiddleware = createMiddleware(routing);

// nexrees: tell server components which page was requested (path + query), so the login guard
// can send the user back there after signing in. Set on every request, so a client cannot supply it.
export default function middleware(request: NextRequest) {
  request.headers.set(PATHNAME_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|marketing|.*\\..*).*)"],
};
