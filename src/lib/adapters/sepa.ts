// SEPA-Lastschrift-Export (pain.008.001.02, SEPA Core) für den Hausgeld-/Miet-Einzug.
//
// nexrees: rewritten so banks accept the file. Upstream used a placeholder creditor id and IBAN,
// no requested collection date (ReqdColltnDt) and no mandate signature date (DtOfSgntr), both
// mandatory in pain.008, always sequence RCUR and the same EndToEndId for every debit. Now:
// creditor data per company (validated), one payment block per sequence type (FRST/RCUR), unique
// end-to-end ids, field lengths of the DK specification, TARGET2 business days.

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

/** Characters allowed by the DK SEPA character set (incl. German umlauts); others become a blank. */
export function sepaText(s: string, max: number): string {
  return s
    .replace(/[^A-Za-z0-9 /?:().,'+\-ÄÖÜäöüß&*$%]/g, " ")
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
        <DrctDbtTx><MndtRltdInf><MndtId>${esc(sepaText(e.mandateRef, 35))}</MndtId><DtOfSgntr>${ymd(e.mandateSignedAt)}</DtOfSgntr></MndtRltdInf></DrctDbtTx>
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
