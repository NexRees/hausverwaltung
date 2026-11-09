// nexrees: decides whether test-data scripts (prisma/scale-seed.ts) may run.
// Deployed containers always have NODE_ENV=production (staging too), so the environment is read
// from APP_ENV, which Terraform sets per environment. Without APP_ENV in a production build we
// cannot tell, so refuse.
export function seedAllowed(env: { NODE_ENV?: string; APP_ENV?: string }): boolean {
  if (env.APP_ENV) return env.APP_ENV !== "production";
  return env.NODE_ENV !== "production";
}
