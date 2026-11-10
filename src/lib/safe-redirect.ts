// nexrees: after signing in, users go back to the page they asked for. The target comes from the
// URL (?callbackUrl=), so only same-origin paths are accepted: no "//host", no scheme, no
// backslashes or control characters (open-redirect protection).

/** Request header the middleware sets to the requested path and query (see src/middleware.ts). */
export const PATHNAME_HEADER = "x-pathname";

const ORIGIN = "http://nexrees.invalid";
const MAX_LENGTH = 2048;

/** The path to return to, or null when `raw` is not a safe same-origin path. */
export function safeCallbackPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_LENGTH) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  // Browsers treat "\" like "/" ("/\evil.com" = "//evil.com"); control characters can hide that.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== ORIGIN) return null;
  const path = url.pathname + url.search + url.hash;
  // Dot segments can collapse "/..//host" or "/de/%2e%2e//host" into "//host": check the result again.
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  // Never back to the sign-in or setup page itself (would loop) or to the API.
  if (/^\/(?:[A-Za-z]{2}(?:-[A-Za-z]{2})?\/)?(?:login|setup|api)(?:[/?#]|$)/.test(path)) return null;
  return path;
}

/**
 * Where the guard sends a signed-out user: the login page of the requested page's locale, with
 * that page as `callbackUrl`. Without a usable path (API route, no middleware) plain "/login".
 */
export function loginUrlFor(requested: string | null | undefined, locales: readonly string[]): string {
  const path = safeCallbackPath(requested);
  if (!path) return "/login";
  const segments = path.split(/[/?#]/);
  const locale = locales.includes(segments[1]) ? segments[1] : null;
  if (!locale) return `/login?callbackUrl=${encodeURIComponent(path)}`;
  // The locale root is where a login lands anyway.
  if (segments.length === 2 || (segments.length === 3 && segments[2] === "")) return `/${locale}/login`;
  return `/${locale}/login?callbackUrl=${encodeURIComponent(path)}`;
}
