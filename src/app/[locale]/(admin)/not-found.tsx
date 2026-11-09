// nexrees: a deleted or unknown record (notFound() in a detail page) keeps the app shell.
import { NotFoundState } from "@/components/error-state";

export default function AdminNotFound() {
  return <NotFoundState />;
}
