// nexrees: unknown addresses get a translated page with a way back instead of Next's English 404.
import { NotFoundState } from "@/components/error-state";

export default function LocaleNotFound() {
  return (
    <main id="main" className="p-4 md:p-6">
      <NotFoundState />
    </main>
  );
}
