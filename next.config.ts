import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker imajını küçük tutmak için tek klasörde toplanmış çıktı üretir.
  output: "standalone",
  // better-sqlite3 native bir modül; bundle edilmeden node_modules'tan yüklenmeli.
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    // Sunucu action'larıyla toplu işlem (ekstre yapıştırma) yaparken limit gerekiyor.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
