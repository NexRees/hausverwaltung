/**
 * Lesbare Vordergrundfarbe (Text) für eine Hintergrundfarbe (#RRGGBB).
 * Ohne passenden Kontrast wirken Buttons je nach Brand-Farbe "ausgegraut".
 * nexrees: picks whichever of dark text or white has the higher WCAG 2.x contrast ratio. The old
 * perceived-brightness threshold chose white for mid tones (amber, green), which failed 4.5:1.
 */
const DARK = "#111827";
const LIGHT = "#ffffff";

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of #RRGGBB, or null for anything else. */
export function relativeLuminance(hex: string | null | undefined): number | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex ?? "").trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  return 0.2126 * channel((int >> 16) & 255) + 0.7152 * channel((int >> 8) & 255) + 0.0722 * channel(int & 255);
}

/** WCAG contrast ratio between two #RRGGBB colours (1–21), or null if either is invalid. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function readableForeground(hex: string | null | undefined): string {
  if (relativeLuminance(hex) === null) return LIGHT;
  const onDark = contrastRatio(hex!, DARK)!;
  const onLight = contrastRatio(hex!, LIGHT)!;
  return onDark > onLight ? DARK : LIGHT;
}
