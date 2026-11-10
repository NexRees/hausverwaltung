"use client";

// nexrees: last resort when the root layout itself fails. It renders its own document, without the
// app's styles or translations, so it stays plain, bilingual and readable in both colour schemes.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="de">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "4rem 1rem", colorScheme: "light dark" }}>
        <title>Fehler · Error</title>
        <main role="alert" style={{ maxWidth: "32rem", margin: "0 auto", textAlign: "center", lineHeight: 1.5 }}>
          <h1 style={{ fontSize: "1.5rem" }}>Die Anwendung konnte nicht geladen werden</h1>
          <p>Bitte erneut versuchen. Bleibt der Fehler, nennen Sie dem Support die Fehlernummer.</p>
          <p lang="en">The application could not be loaded. Please try again.</p>
          {error.digest && <p style={{ fontSize: "0.85rem" }}>Fehlernummer / Error reference: {error.digest}</p>}
          <button type="button" onClick={() => retry()} style={{ font: "inherit", padding: "0.5rem 1rem", cursor: "pointer" }}>
            Erneut versuchen / Try again
          </button>
        </main>
      </body>
    </html>
  );
}
