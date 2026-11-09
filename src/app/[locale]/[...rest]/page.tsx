import { notFound } from "next/navigation";

// nexrees: routes every unknown address under a locale to [locale]/not-found.tsx, which has the
// translations; without it Next renders its built-in English 404.
export default function CatchAll() {
  notFound();
}
