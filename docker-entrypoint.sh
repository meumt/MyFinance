#!/bin/sh
set -e

# AUTH_SECRET olmadan oturum imzalanamaz; sessizce zayıf bir varsayılana
# düşmek yerine açıkça hata verilir.
if [ -z "$AUTH_SECRET" ] || [ ${#AUTH_SECRET} -lt 32 ]; then
  echo "HATA: AUTH_SECRET tanımlı değil veya 32 karakterden kısa." >&2
  echo "  Üretmek için: openssl rand -base64 48" >&2
  exit 1
fi

DB_PATH="${DATABASE_PATH:-/data/myfinance.db}"
DB_DIR="$(dirname "$DB_PATH")"

mkdir -p "$DB_DIR"
chown -R node:node "$DB_DIR" 2>/dev/null || true

# Şemayı uygula (uygulanmış migration'lar atlanır).
echo "→ Veritabanı şeması kontrol ediliyor: $DB_PATH"
su-exec node node dist-scripts/migrate.cjs

# İlk çalıştırmada kullanıcı ve başlangıç verilerini oluştur.
if [ ! -f "$DB_DIR/.seeded" ]; then
  echo "→ Başlangıç verileri yükleniyor"
  su-exec node node dist-scripts/seed.cjs
  su-exec node touch "$DB_DIR/.seeded"
fi

echo "→ Başlatılıyor: $*"
exec su-exec node "$@"
