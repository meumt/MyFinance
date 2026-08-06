import "server-only";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import * as schema from "./schema";

const DB_PATH = process.env.DATABASE_PATH ?? "./data/myfinance.db";

function createConnection() {
  const dir = path.dirname(DB_PATH);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(DB_PATH);
  // WAL: okuma ve yazma birbirini kilitlemez — tek kullanıcılı sunucu için ideal.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return sqlite;
}

// Next.js geliştirme modunda hot reload her seferinde modülü yeniden çalıştırır;
// bağlantıyı global'de tutmazsak dosya tanıtıcıları birikir.
const globalForDb = globalThis as unknown as {
  __myfinanceSqlite?: Database.Database;
};

const sqlite = globalForDb.__myfinanceSqlite ?? createConnection();
if (process.env.NODE_ENV !== "production") {
  globalForDb.__myfinanceSqlite = sqlite;
}

export const db = drizzle(sqlite, { schema });
export { sqlite, schema };
