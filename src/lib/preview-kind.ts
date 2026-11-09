// nexrees: welche Vorschau ein Dokument bekommt (siehe document-preview.tsx).
// Nur Formate, die der Browser selbst sicher darstellt; alles andere → Download.

export type PreviewKind = "pdf" | "image" | "audio" | "video" | "text" | "none";

// Raster- und gängige Browserformate; SVG bewusst nicht (kann Skripte enthalten).
const IMAGE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"]);
const TEXT_EXT = /\.(txt|md|markdown|csv|log|json|xml)$/i;

export function previewKind(mime: string, name = ""): PreviewKind {
  const m = mime.toLowerCase().split(";")[0].trim();
  if (m === "application/pdf" || (!m && /\.pdf$/i.test(name))) return "pdf";
  if (IMAGE.has(m)) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("text/") || m === "application/json" || m === "application/xml") return "text";
  if ((!m || m === "application/octet-stream") && TEXT_EXT.test(name)) return "text";
  if ((!m || m === "application/octet-stream") && /\.pdf$/i.test(name)) return "pdf";
  return "none";
}
