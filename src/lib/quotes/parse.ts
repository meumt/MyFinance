import { PRICE_SCALE } from "../portfolio";

/**
 * Sağlayıcı yanıtlarından sayı ve tarih çıkarmak için toleranslı araçlar.
 *
 * Fonoloji'nin alan adları dokümana erişilemediği için kesin bilinmiyor.
 * Körlemesine tek bir isme bağlanmak yerine bilinen adaylar aranır; hiçbiri
 * bulunmazsa yanıt HATA olarak işaretlenir ve ham örneği saklanır — yanlış
 * bir fiyat göstermek, fiyat gösterememekten kötüdür.
 */

export type Json = unknown;

/** Nesne mi (dizi ve null hariç). */
function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** "a.b.c" yolundan değer okur; dizide ilk elemana iner. */
export function atPath(root: Json, path: string): Json {
  let current: Json = root;
  for (const part of path.split(".")) {
    if (Array.isArray(current)) current = current[0];
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Verilen yollardan ilk geçerli sayıyı döner.
 * Metin gelirse Türkçe/İngilizce ondalık ayırıcıların ikisi de kabul edilir.
 */
export function pickNumber(root: Json, paths: string[]): number | null {
  for (const path of paths) {
    const value = toNumber(atPath(root, path));
    if (value !== null) return value;
  }
  return null;
}

export function toNumber(value: Json): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (raw === "") return null;

  /* "1.234,5678" (TR) ile "1,234.5678" (EN) birbirinden ayırt edilir:
     son görülen ayırıcı ondalık noktasıdır. */
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized = raw.replace(/[^\d,.\-]/g, "");

  if (lastComma > lastDot) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    normalized = normalized.replace(/,/g, "");
  } else {
    normalized = normalized.replace(",", ".");
  }

  /* En az bir rakam şart: "abc" temizlendiğinde boş kalır ve Number("") 0
     döner — anlamsız bir metin sessizce sıfır fiyata dönüşmemeli. */
  if (!/\d/.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Sayıyı micro tam sayıya çevirir (fiyat × 1e6). */
export function toPriceMicro(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * PRICE_SCALE);
}

/** Verilen yollardan ilk YYYY-MM-DD tarihini döner. */
export function pickDate(root: Json, paths: string[]): string | null {
  for (const path of paths) {
    const value = atPath(root, path);
    const iso = toISODate(value);
    if (iso) return iso;
  }
  return null;
}

export function toISODate(value: Json): string | null {
  if (typeof value === "number") {
    // Saniye ya da milisaniye epoch olabilir.
    const ms = value > 1e11 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);

  /* "17.08.2026" ya da "17/08/2026" */
  const tr = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(trimmed);
  if (tr) return `${tr[3]}-${tr[2]}-${tr[1]}`;

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** Yanıtın hata teşhisi için saklanacak kırpılmış hali. */
export function rawSampleOf(value: Json, limit = 600): string {
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch {
    return String(value).slice(0, limit);
  }
}
