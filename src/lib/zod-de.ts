// nexrees: plain-German validation messages for every zod schema (forms, portal, API, MCP).
// zod's defaults were English ("Too small: expected string to have >=1 characters") even in the
// German UI. The common cases get short, user-facing wording; anything else falls back to zod's
// own German locale. The field itself is named by the form (CrudDialog shows the message next to
// the field and prefixes the summary with the field's label), so messages don't repeat it. The API
// and MCP have no form: they use apiIssueMessage(), which adds the field and the allowed values.
import { z } from "zod";

type Issue = {
  code?: string;
  origin?: string;
  minimum?: unknown;
  maximum?: unknown;
  inclusive?: boolean;
  format?: string;
  expected?: string;
  input?: unknown;
};

const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : (v as number));

export function germanMessage(iss: Issue): string | undefined {
  switch (iss.code) {
    case "too_small": {
      const min = num(iss.minimum);
      if (iss.origin === "string") return min <= 1 ? "Pflichtfeld – bitte ausfüllen." : `Mindestens ${min} Zeichen.`;
      if (iss.origin === "array" || iss.origin === "set") return min <= 1 ? "Bitte mindestens einen Eintrag auswählen." : `Bitte mindestens ${min} Einträge auswählen.`;
      if (iss.origin === "number" || iss.origin === "bigint")
        return iss.inclusive === false ? `Muss größer als ${min} sein.` : `Muss mindestens ${min} sein.`;
      if (iss.origin === "date") return "Das Datum liegt zu früh.";
      return undefined;
    }
    case "too_big": {
      const max = num(iss.maximum);
      if (iss.origin === "string") return `Höchstens ${max} Zeichen.`;
      if (iss.origin === "array" || iss.origin === "set") return `Höchstens ${max} Einträge.`;
      if (iss.origin === "number" || iss.origin === "bigint")
        return iss.inclusive === false ? `Muss kleiner als ${max} sein.` : `Darf höchstens ${max} sein.`;
      if (iss.origin === "date") return "Das Datum liegt zu spät.";
      return undefined;
    }
    case "invalid_format":
      if (iss.format === "email") return "Bitte eine gültige E-Mail-Adresse eingeben.";
      if (iss.format === "url") return "Bitte eine gültige Adresse (URL) eingeben.";
      if (iss.format === "date" || iss.format === "datetime") return "Bitte ein gültiges Datum eingeben.";
      return "Ungültiges Format.";
    case "invalid_value":
      return "Bitte einen gültigen Wert auswählen.";
    case "invalid_type":
      if (iss.input === undefined || iss.input === null || iss.input === "") return "Pflichtfeld – bitte ausfüllen.";
      if (iss.expected === "date") return "Bitte ein gültiges Datum eingeben.";
      // zod raises expected "int" only for a finite number with a fractional part.
      if (iss.expected === "int") return "Bitte eine ganze Zahl eingeben.";
      if (iss.expected === "number" || iss.expected === "bigint") return "Bitte eine gültige Zahl eingeben.";
      return undefined;
    default:
      return undefined;
  }
}

/**
 * One validation problem for API and MCP callers, who have no form to point at the field:
 * "type: Bitte einen gültigen Wert auswählen. (erlaubt: WOHNEN, GEWERBE)".
 */
export function apiIssueMessage(iss: { path?: readonly PropertyKey[]; message: string; code?: string; values?: readonly unknown[] }): string {
  const field = iss.path?.length ? `${iss.path.map(String).join(".")}: ` : "";
  const allowed = iss.code === "invalid_value" && iss.values?.length ? ` (erlaubt: ${iss.values.map(String).join(", ")})` : "";
  return `${field}${iss.message}${allowed}`;
}

let installed = false;
/** Installs the German messages once per process (zod config is global). */
export function installGermanZodMessages() {
  if (installed) return;
  installed = true;
  z.config(z.locales.de());
  z.config({ customError: (iss) => germanMessage(iss as Issue) });
}
