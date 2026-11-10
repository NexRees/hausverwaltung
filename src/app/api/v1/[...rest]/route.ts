// nexrees: unknown /api/v1 paths answer JSON 404 { error, code } instead of the app's HTML 404 page
import { jsonError } from "@/lib/api-http";

const notFound = (req: Request) =>
  jsonError(404, "not_found", `Unbekannter Endpunkt: ${req.method} ${new URL(req.url).pathname}. Siehe /api/v1/openapi.json`);

export const GET = async (req: Request) => notFound(req);
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
