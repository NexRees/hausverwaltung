import { describe, expect, it } from "vitest";
import { previewKind } from "./preview-kind";

describe("previewKind", () => {
  it("erkennt PDF, auch ohne oder mit generischem MIME-Typ", () => {
    expect(previewKind("application/pdf")).toBe("pdf");
    expect(previewKind("", "Abrechnung.pdf")).toBe("pdf");
    expect(previewKind("application/octet-stream", "scan.PDF")).toBe("pdf");
  });

  it("zeigt Rasterbilder, aber kein SVG", () => {
    expect(previewKind("image/jpeg")).toBe("image");
    expect(previewKind("image/png; charset=binary")).toBe("image");
    expect(previewKind("image/svg+xml")).toBe("none");
  });

  it("Audio, Video und Text", () => {
    expect(previewKind("audio/mpeg")).toBe("audio");
    expect(previewKind("video/mp4")).toBe("video");
    expect(previewKind("text/plain")).toBe("text");
    expect(previewKind("text/html")).toBe("text"); // als Text, nie gerendert
    expect(previewKind("application/octet-stream", "notiz.md")).toBe("text");
  });

  it("Office-Dateien und Unbekanntes → Download", () => {
    expect(previewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("none");
    expect(previewKind("application/zip")).toBe("none");
  });
});
