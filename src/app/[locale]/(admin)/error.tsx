"use client";

// nexrees: a failing page keeps the app shell (navigation, search) instead of a blank screen.
import { ErrorState } from "@/components/error-state";

export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorState error={error} retry={retry} />;
}
