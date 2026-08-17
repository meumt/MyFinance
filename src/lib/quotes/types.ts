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
