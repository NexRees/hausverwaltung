"use client";

// nexrees: per-field validation messages from a server action (ActionState.fieldErrors), handed
// from CrudDialog to the form fields, which mark themselves aria-invalid and show the message.
import * as React from "react";

const FieldErrorsContext = React.createContext<Record<string, string>>({});

export function FieldErrorsProvider({ errors, children }: { errors: Record<string, string>; children: React.ReactNode }) {
  return <FieldErrorsContext.Provider value={errors}>{children}</FieldErrorsContext.Provider>;
}

export function fieldErrorId(name: string) {
  return `${name}-error`;
}

/** The message for one field (by input name), plus the props that tie it to the input. */
export function useFieldError(name: string, hintId?: string) {
  const message = React.useContext(FieldErrorsContext)[name];
  const describedBy = [message ? fieldErrorId(name) : null, hintId ?? null].filter(Boolean).join(" ") || undefined;
  return {
    message,
    inputProps: { "aria-invalid": message ? (true as const) : undefined, "aria-describedby": describedBy },
  };
}

export function FieldErrorText({ name, message }: { name: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={fieldErrorId(name)} className="text-sm text-destructive">
      {message}
    </p>
  );
}
