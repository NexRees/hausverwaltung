import { describe, it, expect } from "vitest";
import { toPain008, earliestCollectionDate, isTargetDay, sepaText, type SepaEntry } from "./sepa";

const creditor = { name: "NexRees Verwaltung", iban: "DE89370400440532013000", creditorId: "DE98ZZZ09999999999" };
const entry = (n: number, sequence: "FRST" | "RCUR", amount: number): SepaEntry => ({
  mandateRef: `M-${n}`,
  mandateSignedAt: new Date("2025-03-01T00:00:00Z"),
  sequence,
  iban: "DE89370400440532013000",
  debtorName: `Mieter ${n}`,
  amount,
  reference: `Miete 11/2026 Mandat M-${n}`,
  endToEndId: `MSG-${n}`,
});

describe("pain.008", () => {
  const xml = toPain008([entry(1, "FRST", 500.1), entry(2, "RCUR", 799.9), entry(3, "RCUR", 100)], {
    creditor,
    msgId: "MSG",
    createdAt: new Date("2026-11-09T10:00:00Z"),
    collectionDate: new Date("2026-11-12T00:00:00Z"),
  });

  it("has the mandatory elements upstream was missing", () => {
    expect(xml).toContain("<ReqdColltnDt>2026-11-12</ReqdColltnDt>");
    expect(xml).toContain("<DtOfSgntr>2025-03-01</DtOfSgntr>");
    expect(xml).toContain("<ChrgBr>SLEV</ChrgBr>");
    expect(xml).toContain("<Id>DE98ZZZ09999999999</Id>");
  });

  it("splits FRST and RCUR into separate payment blocks with correct sums", () => {
    expect(xml.match(/<PmtInf>/g)).toHaveLength(2);
    expect(xml).toContain("<SeqTp>FRST</SeqTp>");
    expect(xml).toContain("<SeqTp>RCUR</SeqTp>");
    expect(xml).toMatch(/<GrpHdr>[\s\S]*<NbOfTxs>3<\/NbOfTxs>[\s\S]*<CtrlSum>1400.00<\/CtrlSum>/);
    expect(xml).toContain("<CtrlSum>899.90</CtrlSum>");
  });

  it("uses a unique end-to-end id per debit", () => {
    const ids = [...xml.matchAll(/<EndToEndId>([^<]+)<\/EndToEndId>/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(3);
  });

  it("cleans text to the SEPA character set and length", () => {
    expect(sepaText("Müller <&> GmbH ✓ #1", 70)).toBe("Müller & GmbH 1");
    expect(sepaText("x".repeat(200), 140)).toHaveLength(140);
  });
});

describe("collection dates", () => {
  it("skips weekends and TARGET holidays", () => {
    expect(isTargetDay(new Date("2026-12-25T00:00:00Z"))).toBe(false);
    expect(isTargetDay(new Date("2026-04-03T00:00:00Z"))).toBe(false); // Good Friday 2026
    expect(isTargetDay(new Date("2026-04-06T00:00:00Z"))).toBe(false); // Easter Monday 2026
    expect(isTargetDay(new Date("2026-04-07T00:00:00Z"))).toBe(true);
  });
  it("is two TARGET days ahead", () => {
    expect(earliestCollectionDate(new Date("2026-11-09T15:00:00Z")).toISOString().slice(0, 10)).toBe("2026-11-11"); // Mon -> Wed
    expect(earliestCollectionDate(new Date("2026-11-13T15:00:00Z")).toISOString().slice(0, 10)).toBe("2026-11-17"); // Fri -> Tue
    expect(earliestCollectionDate(new Date("2026-12-23T15:00:00Z")).toISOString().slice(0, 10)).toBe("2026-12-28"); // Thu 24th counts, 25th/26th and weekend skipped
  });
});
