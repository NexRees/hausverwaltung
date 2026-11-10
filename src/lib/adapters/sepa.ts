// SEPA-Lastschrift-Export (pain.008.001.02, SEPA Core) für den Hausgeld-/Miet-Einzug.
//
// nexrees: rewritten so banks accept the file. Upstream used a placeholder creditor id and IBAN,
// no requested collection date (ReqdColltnDt) and no mandate signature date (DtOfSgntr), both
// mandatory in pain.008, always sequence RCUR and the same EndToEndId for every debit. Now:
// creditor data per company (validated), one payment block per sequence type (FRST/RCUR), unique
// end-to-end ids, field lengths of the DK specification, TARGET2 business days.

import { mandateRefValid } from "@/lib/sepa-validate";

export type SeqType = "FRST" | "RCUR";

export interface SepaEntry {
  mandateRef: string;
  mandateSignedAt: Date;
  sequence: SeqType;
  iban: string;
  bic?: string | null;
  debtorName: string;
  amount: number;
  reference: string; // Verwendungszweck (max. 140)
  endToEndId: string; // eindeutig (max. 35)
}

export interface SepaCreditor {
  name: string;
  iban: string;
  bic?: string | null;
  creditorId: string;
}

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

const ALLOWED = /[A-Za-z0-9 /?:().,'+\-ÄÖÜäöüß&*$%]/;

// Letters that do not decompose into a Latin base letter, plus Cyrillic and Greek (simple
// transliteration, as banks print them). Upper case; lower case is derived.
const TRANSLIT: Record<string, string> = {
  Ł: "L", Ø: "O", Æ: "AE", Œ: "OE", Đ: "D", Ð: "D", Þ: "TH", ẞ: "SS", Ħ: "H", Ŀ: "L", Ŋ: "N", ı: "i",
  А: "A", Б: "B", В: "V", Г: "G", Ґ: "G", Д: "D", Ђ: "DJ", Е: "E", Ё: "E", Є: "YE", Ж: "ZH", З: "Z", И: "I", І: "I",
  Ї: "YI", Й: "Y", Ј: "J", К: "K", Л: "L", Љ: "LJ", М: "M", Н: "N", Њ: "NJ", О: "O", П: "P", Р: "R", С: "S",
  Т: "T", Ћ: "C", У: "U", Ў: "U", Ф: "F", Х: "KH", Ц: "TS", Ч: "CH", Џ: "DZ", Ш: "SH", Щ: "SHCH", Ъ: "", Ы: "Y",
  Ь: "", Э: "E", Ю: "YU", Я: "YA",
  Α: "A", Β: "V", Γ: "G", Δ: "D", Ε: "E", Ζ: "Z", Η: "I", Θ: "TH", Ι: "I", Κ: "K", Λ: "L", Μ: "M", Ν: "N",
  Ξ: "X", Ο: "O", Π: "P", Ρ: "R", Σ: "S", Τ: "T", Υ: "Y", Φ: "F", Χ: "CH", Ψ: "PS", Ω: "O",
};
for (const [k, v] of Object.entries(TRANSLIT)) {
  const lower = k.toLowerCase();
  if (lower !== k && !(lower in TRANSLIT)) TRANSLIT[lower] = v.toLowerCase();
}
TRANSLIT["ς"] = "s";

function latin(ch: string, next: string | undefined): string {
  if (ALLOWED.test(ch)) return ch;
  const t = TRANSLIT[ch];
  if (t !== undefined) {
    // "Жуков" → "Zhukov", not "ZHukov"
    return t.length > 1 && ch !== ch.toLowerCase() && next && next !== next.toUpperCase() ? t[0] + t.slice(1).toLowerCase() : t;
  }
  const base = ch.normalize("NFD").replace(/\p{M}/gu, ""); // é → e, Ç → C, Ş → S
  if (base && [...base].every((c) => ALLOWED.test(c))) return base;
  const viaTable = [...base].map((c) => TRANSLIT[c] ?? "").join(""); // ǿ → ø → o
  return viaTable || " ";
}

/**
 * Text in the DK SEPA character set (incl. German umlauts): other Latin letters lose their
 * accents, Cyrillic and Greek are transliterated, anything else becomes a blank.
 */
export function sepaText(s: string, max: number): string {
  const chars = [...s];
  return chars
    .map((ch, i) => latin(ch, chars[i + 1]))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const cents = (n: number) => Math.round(n * 100);
const fmt = (c: number) => (c / 100).toFixed(2);

function easterSunday(year: number): Date {
  // Anonymous Gregorian algorithm
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** TARGET2 business day (no weekend, 1 Jan, Good Friday, Easter Monday, 1 May, 25/26 Dec). */
export function isTargetDay(d: Date): boolean {
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  const md = `${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  if (["1-1", "5-1", "12-25", "12-26"].includes(md)) return false;
  const easter = easterSunday(d.getUTCFullYear()).getTime();
  const day = 86_400_000;
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return t !== easter - 2 * day && t !== easter + day;
}

/** Earliest collection date for a file submitted today: two TARGET days ahead (D-1 plus a day of slack). */
export function earliestCollectionDate(today: Date): Date {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  let n = 0;
  while (n < 2) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isTargetDay(d)) n++;
  }
  return d;
}

export function toPain008(
  entries: SepaEntry[],
  opts: { creditor: SepaCreditor; msgId: string; createdAt: Date; collectionDate: Date },
): string {
  const { creditor } = opts;
  // The mandate reference goes out exactly as signed; the caller checks it (mandateRefValid).
  const bad = entries.find((e) => !mandateRefValid(e.mandateRef) || !sepaText(e.debtorName, 70));
  if (bad) throw new Error(`SEPA: Mandat ${bad.mandateRef} hat eine ungültige Referenz oder keinen druckbaren Namen`);
  const total = entries.reduce((a, e) => a + cents(e.amount), 0);
  const agent = (bic?: string | null) =>
    bic ? `<FinInstnId><BIC>${esc(bic)}</BIC></FinInstnId>` : `<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>`;

  const blocks = (["FRST", "RCUR"] as SeqType[])
    .map((seq) => {
      const list = entries.filter((e) => e.sequence === seq);
      if (list.length === 0) return "";
      const sum = list.reduce((a, e) => a + cents(e.amount), 0);
      const txs = list
        .map(
          (e) => `      <DrctDbtTxInf>
        <PmtId><EndToEndId>${esc(sepaText(e.endToEndId, 35))}</EndToEndId></PmtId>
        <InstdAmt Ccy="EUR">${fmt(cents(e.amount))}</InstdAmt>
        <DrctDbtTx><MndtRltdInf><MndtId>${esc(e.mandateRef)}</MndtId><DtOfSgntr>${ymd(e.mandateSignedAt)}</DtOfSgntr></MndtRltdInf></DrctDbtTx>
        <DbtrAgt>${agent(e.bic)}</DbtrAgt>
        <Dbtr><Nm>${esc(sepaText(e.debtorName, 70))}</Nm></Dbtr>
        <DbtrAcct><Id><IBAN>${esc(e.iban)}</IBAN></Id></DbtrAcct>
        <RmtInf><Ustrd>${esc(sepaText(e.reference, 140))}</Ustrd></RmtInf>
      </DrctDbtTxInf>`,
        )
        .join("\n");
      return `    <PmtInf>
      <PmtInfId>${esc(`${opts.msgId}-${seq}`.slice(0, 35))}</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <NbOfTxs>${list.length}</NbOfTxs>
      <CtrlSum>${fmt(sum)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>CORE</Cd></LclInstrm><SeqTp>${seq}</SeqTp></PmtTpInf>
      <ReqdColltnDt>${ymd(opts.collectionDate)}</ReqdColltnDt>
      <Cdtr><Nm>${esc(sepaText(creditor.name, 70))}</Nm></Cdtr>
      <CdtrAcct><Id><IBAN>${esc(creditor.iban)}</IBAN></Id></CdtrAcct>
      <CdtrAgt>${agent(creditor.bic)}</CdtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      <CdtrSchmeId><Id><PrvtId><Othr><Id>${esc(creditor.creditorId)}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>
${txs}
    </PmtInf>`;
    })
    .filter(Boolean)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${esc(opts.msgId.slice(0, 35))}</MsgId>
      <CreDtTm>${opts.createdAt.toISOString().slice(0, 19)}</CreDtTm>
      <NbOfTxs>${entries.length}</NbOfTxs>
      <CtrlSum>${fmt(total)}</CtrlSum>
      <InitgPty><Nm>${esc(sepaText(creditor.name, 70))}</Nm></InitgPty>
    </GrpHdr>
${blocks}
  </CstmrDrctDbtInitn>
</Document>`;
}

/** Earliest collection date for a file created now (YYYY-MM-DD), for forms. */
export function earliestCollectionDay(): string {
  return earliestCollectionDate(new Date()).toISOString().slice(0, 10);
}
