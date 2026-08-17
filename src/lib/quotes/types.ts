/**
 * Hız sınırına takılan hataların başına konur.
 *
 * Metne bakmak kırılgan görünse de tek doğruluk kaynağı budur: hata
 * mesajı zaten veritabanında saklanıyor ve bu işaret sayesinde ayrı bir
 * sütuna gerek kalmadan "bu sembolü bir süre rahat bırak" kararı verilebilir.
 */
export const RATE_LIMIT_PREFIX = "Hız sınırı";

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
    }
  | {
      symbol: string;
      ok: false;
      error: string;
      /** Ayrıştırma başarısızsa yanıtın kırpılmış hali. */
      rawSample?: string;
    };
