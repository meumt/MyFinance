/**
 * Hız sınırına takılan hataların başına konur.
 *
 * Metne bakmak kırılgan görünse de tek doğruluk kaynağı budur: hata
 * mesajı zaten veritabanında saklanıyor ve bu işaret sayesinde ayrı bir
 * sütuna gerek kalmadan "bu sembolü bir süre rahat bırak" kararı verilebilir.
 */
export const RATE_LIMIT_PREFIX = "Hız sınırı";

/** Seans dışı fiyat bilgisi. */
export interface ExtendedSessionQuote {
  /** Seans dışı son fiyat × 1e6. */
  priceMicro: number;
  /** Önceki normal seans kapanışına göre değişim, baz puan (100 = %1). */
  changeBps: number | null;
  /** oncesi = pre-market, sonrasi = after-hours. */
  session: "oncesi" | "sonrasi";
}

/** Bir sağlayıcıdan dönen tek fiyat sonucu. */
export type FetchedQuote =
  | {
      symbol: string;
      ok: true;
      /** Birim fiyat × 1e6. */
      priceMicro: number;
      previousCloseMicro: number | null;
      currency: string;
      /** Fiyatın ait olduğu gün. */
      asOf: string | null;
      /** Sağlayıcının bildirdiği isim — kullanıcı boş bıraktıysa doldurulur. */
      name: string | null;
      /**
       * Seans dışı (pre-market / after-hours) fiyat. Yalnızca ABD
       * hisselerinde ve yalnızca o seans sürerken gelir; yoksa null.
       */
      extended?: ExtendedSessionQuote | null;
    }
  | {
      symbol: string;
      ok: false;
      error: string;
      /** Ayrıştırma başarısızsa yanıtın kırpılmış hali. */
      rawSample?: string;
    };
