import { desc, sql } from "drizzle-orm";

import { db } from "@/db";
import { exchangeRates, notifications } from "@/db/schema";
import { getSettings, maskSecrets } from "@/lib/settings";
import { SettingsClient } from "./settings-client";

export const metadata = { title: "Ayarlar" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, rateRows, counts] = await Promise.all([
    getSettings(),
    db.select().from(exchangeRates).orderBy(desc(exchangeRates.date)),
    db.select({ count: sql<number>`count(*)` }).from(notifications),
  ]);

  /* Her para birimi için yalnızca en güncel kur gösterilir. */
  const latest = new Map<string, (typeof rateRows)[number]>();
  for (const row of rateRows) {
    if (!latest.has(row.code)) latest.set(row.code, row);
  }

  return (
    <SettingsClient
      // Jetonlar ve şifreler tarayıcıya ham gönderilmez.
      settings={maskSecrets(settings)}
      rates={[...latest.values()].map((r) => ({
        code: r.code,
        rateMicro: r.rateMicro,
        date: r.date,
        source: r.source,
      }))}
      notificationCount={counts[0]?.count ?? 0}
    />
  );
}
