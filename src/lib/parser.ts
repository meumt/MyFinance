import { type ISODate, today } from "./dates";
import { parseMoneyToMinor } from "./money";

/**
 * Hızlı giriş ve toplu ekstre yapıştırma için metin ayrıştırıcılar.
 * Amaç: elle form doldurmadan, tek satır yazarak harcama girebilmek.
 */

/** Türkçe karakterleri sadeleştirip eşleştirme anahtarı üretir. */
export function normalizeTr(input: string): string {
  return input
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ────────────────────────────── Hızlı giriş ────────────────────────────── */

export interface QuickEntry {
  amountMinor: number | null;
  /** Başına + konursa gelir olarak yorumlanır. */
  kind: "gider" | "gelir";
  merchantName: string;
  /** "1200/12 vestel" → 12 taksit */
  installmentCount: number | null;
  /** "d-2" → iki gün önce; belirtilmezse bugün. */
  date: ISODate;
  raw: string;
}

/**
 * Desteklenen biçimler:
 *   "250 migros"            → 250 TL gider, Migros
 *   "migros 250"            → aynı
 *   "+8500 maaş"            → gelir
 *   "12000/12 vestel"       → 12 taksitli alışveriş
 *   "250 migros d-1"        → dün
 *   "1.234,56 a101 kahvaltı"
 */
export function parseQuickEntry(input: string, ref: ISODate = today()): QuickEntry {
  const raw = input.trim();
  let working = raw;

  /* Gelir işareti */
  let kind: "gider" | "gelir" = "gider";
  if (/^\+/.test(working)) {
    kind = "gelir";
    working = working.slice(1).trim();
  }

  /* Gün kaydırma: d-1, d-2 … */
  let date = ref;
  const dayShift = working.match(/(?:^|\s)d-(\d{1,2})(?:\s|$)/i);
  if (dayShift) {
    const shift = Number(dayShift[1]);
    const d = new Date(`${ref}T00:00:00`);
    d.setDate(d.getDate() - shift);
    date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    working = working.replace(dayShift[0], " ").trim();
  }

  /* Taksit: 12000/12 */
  let installmentCount: number | null = null;
  const installment = working.match(/(\d[\d.,]*)\s*\/\s*(\d{1,2})(?:\s|$)/);
  if (installment) {
    installmentCount = Number(installment[2]);
    working = working.replace(installment[0], ` ${installment[1]} `);
  }

  /* İlk para benzeri simgeyi tutar kabul et */
  const amountToken = working.match(/(?:^|\s)(-?\d[\d.,]*)(?:\s|$)/);
  let amountMinor: number | null = null;
  if (amountToken) {
    amountMinor = parseMoneyToMinor(amountToken[1]);
    working = working.replace(amountToken[0], " ");
  }

  const merchantName = working.replace(/\s+/g, " ").trim();

  return {
    amountMinor: amountMinor != null ? Math.abs(amountMinor) : null,
    kind,
    merchantName,
    installmentCount:
      installmentCount && installmentCount > 1 ? installmentCount : null,
    date,
    raw,
  };
}

/* ──────────────────────── Toplu ekstre yapıştırma ──────────────────────── */

export interface ParsedRow {
  date: ISODate;
  description: string;
  amountMinor: number;
  /** Negatif tutar gider, pozitif gelir kabul edilir. */
  kind: "gider" | "gelir";
  /** "3/12" gibi taksit bilgisi yakalandıysa. */
  installmentInfo: { current: number; total: number } | null;
  raw: string;
  /** Ayrıştırma güvenilir mi? Düşükse kullanıcı onayı istenir. */
  confident: boolean;
}

const DATE_PATTERNS: Array<{ re: RegExp; build: (m: RegExpMatchArray) => string }> = [
  // 05.08.2026 / 05/08/2026 / 05-08-2026
  {
    re: /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/,
    build: (m) => `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`,
  },
  // 2026-08-05
  {
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/,
    build: (m) => `${m[1]}-${m[2]}-${m[3]}`,
  },
  // 05.08.26
  {
    re: /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2})\b/,
    build: (m) => `20${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`,
  },
];

const TR_MONTHS: Record<string, string> = {
  oca: "01", sub: "02", mar: "03", nis: "04", may: "05", haz: "06",
  tem: "07", agu: "08", eyl: "09", eki: "10", kas: "11", ara: "12",
};

/**
 * Banka ekstresinden kopyalanan satırları ayrıştırır.
 * Bankalar farklı biçim kullandığı için tarih ve tutar sezgisel bulunur;
 * sonuç kullanıcı onayına sunulur.
 */
export function parseBulkStatement(
  text: string,
  options: { defaultDate?: ISODate; expenseIsNegative?: boolean } = {},
): ParsedRow[] {
  const defaultDate = options.defaultDate ?? today();
  // Çoğu banka gideri eksi işaretle gösterir; bazıları ayrı sütun kullanır.
  const expenseIsNegative = options.expenseIsNegative ?? true;

  const rows: ParsedRow[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 4) continue;
    // Başlık satırlarını atla
    if (/^(tarih|date|işlem|aciklama|açıklama|tutar)\b/i.test(trimmed)) continue;

    let rest = trimmed;
    let date = defaultDate;
    let dateFound = false;

    for (const { re, build } of DATE_PATTERNS) {
      const m = rest.match(re);
      if (m) {
        date = build(m);
        rest = rest.replace(m[0], " ");
        dateFound = true;
        break;
      }
    }

    if (!dateFound) {
      // "5 Ağu 2026" biçimi
      const m = rest.match(/\b(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]{3})[a-zçğıöşü]*\s+(\d{4})\b/);
      if (m) {
        const month = TR_MONTHS[normalizeTr(m[2]).slice(0, 3)];
        if (month) {
          date = `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
          rest = rest.replace(m[0], " ");
          dateFound = true;
        }
      }
    }

    /* Taksit bilgisi: (3/12) veya 3/12 */
    let installmentInfo: ParsedRow["installmentInfo"] = null;
    const inst = rest.match(/\(?\b(\d{1,2})\s*\/\s*(\d{1,2})\b\)?/);
    if (inst && Number(inst[2]) > 1 && Number(inst[1]) <= Number(inst[2])) {
      installmentInfo = { current: Number(inst[1]), total: Number(inst[2]) };
      rest = rest.replace(inst[0], " ");
    }

    /* Tutar: satırdaki son para benzeri simge */
    const moneyTokens = [...rest.matchAll(/(-|\+)?\s*(\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:₺|TL|TRY)?/gi)]
      .filter((m) => /\d/.test(m[0]) && m[0].trim().length > 0);

    if (moneyTokens.length === 0) continue;

    const chosen = moneyTokens[moneyTokens.length - 1];
    const parsed = parseMoneyToMinor(chosen[2]);
    if (parsed == null || parsed === 0) continue;

    const explicitSign = chosen[1];
    rest = rest.slice(0, chosen.index).concat(rest.slice((chosen.index ?? 0) + chosen[0].length));

    const description = rest
      .replace(/[|;\t]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "")
      .trim();

    const isIncome = expenseIsNegative
      ? explicitSign === "+"
      : explicitSign !== "-";

    rows.push({
      date,
      description: description || "Açıklama yok",
      amountMinor: Math.abs(parsed),
      kind: isIncome ? "gelir" : "gider",
      installmentInfo,
      raw: trimmed,
      confident: dateFound && description.length > 2,
    });
  }

  return rows;
}

/** Aynı satırın iki kez girilmesini engellemek için imza üretir. */
export function rowSignature(row: {
  date: string;
  amountMinor: number;
  description: string;
}): string {
  return `${row.date}|${row.amountMinor}|${normalizeTr(row.description).slice(0, 24)}`;
}
