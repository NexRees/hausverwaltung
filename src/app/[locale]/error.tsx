"use client";

// nexrees: login, portal and setup pages fail with a translated message and a retry.
import { ErrorState } from "@/components/error-state";

export default function LocaleError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main id="main" className="p-4 md:p-6">
      <ErrorState error={error} retry={retry} />
    </main>
  );
}
