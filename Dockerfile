# ─────────────────────────────── Bağımlılıklar ───────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# better-sqlite3 hazır ikili bulamazsa kaynaktan derlenir; araçlar gerekli.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci

# ──────────────────────────────── Derleme ────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Derleme sırasında veritabanına dokunulmaz; sayfalar istek anında üretilir.
ENV NEXT_TELEMETRY_DISABLED=1
# Derleme aşaması için yer tutucu; çalışma anında gerçek değer verilir.
ENV AUTH_SECRET=derleme-asamasi-icin-yer-tutucu-degeri-32-karakter

RUN npm run build

# Yardımcı betikler (migration, seed, bildirim, zamanlayıcı) düz JavaScript'e
# derlenir. Böylece çalışma imajında TypeScript araç zincirine, kaynak koda ya
# da tsconfig'e ihtiyaç kalmaz — yalnızca node yeter.
RUN npm run build:scripts

# ──────────────────────────────── Çalıştırma ─────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache tini su-exec

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV TZ=Europe/Istanbul
ENV DATABASE_PATH=/data/myfinance.db

# standalone çıktısı yalnızca gereken node_modules'ı taşır.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Derlenmiş yardımcı betikler ve migration SQL dosyaları.
COPY --from=builder /app/dist-scripts ./dist-scripts
COPY --from=builder /app/drizzle ./drizzle

COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Veri dizini kalıcı birim olarak bağlanır.
RUN mkdir -p /data && chown -R node:node /data /app

EXPOSE 3000

# tini: sinyalleri düzgün iletir, zombi süreç bırakmaz.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
