import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Sağlık kontrolü. Docker healthcheck ve tünel izleme için kullanılır.
 * Kimlik doğrulaması gerektirmez ama hiçbir finansal veri sızdırmaz.
 */
export async function GET() {
  try {
    // Veritabanına gerçekten erişilebiliyor mu?
    db.get(sql`select 1`);
    return NextResponse.json(
      { durum: "saglikli", zaman: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { durum: "hatali" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
