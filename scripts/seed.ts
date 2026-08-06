/**
 * Başlangıç verilerini yükler: kullanıcı, Türk banka listesi ve kategori ağacı.
 * Tekrar çalıştırılabilir — mevcut kayıtlara dokunmaz.
 *
 * Kullanım:  ADMIN_PASSWORD=... npm run db:seed
 */
import Database from "better-sqlite3";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  p: string,
  s: Buffer,
  k: number,
) => Promise<Buffer>;

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

const dbPath = process.env.DATABASE_PATH ?? "./data/myfinance.db";
const sqlite = new Database(dbPath);
// Başka bir konteyner aynı anda yazıyorsa hata vermek yerine bekle.
sqlite.pragma("busy_timeout = 15000");
sqlite.pragma("foreign_keys = ON");

async function main() {
/* ─────────────────────────────── Kullanıcı ─────────────────────────────── */

const username = process.env.ADMIN_USERNAME ?? "admin";

/* Şifre karması yavaş (scrypt) ve asenkron; işlemi açmadan önce hesaplanır ki
   yazma kilidi gereksiz yere tutulmasın. */
let generatedPassword: string | null = null;
const password =
  process.env.ADMIN_PASSWORD ??
  (generatedPassword = randomBytes(9).toString("base64url"));
const passwordHash = await hashPassword(password);

/* Sunucu yeniden başladığında birden fazla konteyner aynı anda seed
   çalıştırabilir. BEGIN IMMEDIATE yazma kilidini baştan alır; ikinci süreç
   busy_timeout süresince bekler, sonra her şeyi hazır bulup hiçbir şey
   yazmaz. Kilit olmadan "önce kontrol et, sonra yaz" deseni yarışa açıktır. */
sqlite.exec("BEGIN IMMEDIATE");

let committed = false;
const rollbackOnFailure = () => {
  if (!committed) {
    try {
      sqlite.exec("ROLLBACK");
    } catch {
      /* işlem zaten kapanmışsa yapacak bir şey yok */
    }
  }
};

try {

const existingUser = sqlite
  .prepare("SELECT id FROM users WHERE username = ?")
  .get(username) as { id: number } | undefined;

if (!existingUser) {
  sqlite
    .prepare(
      "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)",
    )
    .run(username, passwordHash, process.env.ADMIN_DISPLAY_NAME ?? "Ben");
  console.log(`✓ Kullanıcı oluşturuldu: ${username}`);
} else {
  console.log(`· Kullanıcı zaten var: ${username}`);
  // Kullanıcı zaten varsa üretilen şifre kullanılmadı; ekranda gösterme.
  generatedPassword = null;
}

/* ────────────────────────── Bankalar & kurumlar ────────────────────────── */

const INSTITUTIONS: Array<[name: string, short: string, color: string]> = [
  // Kamu
  ["Ziraat Bankası", "Ziraat", "#e2001a"],
  ["VakıfBank", "VakıfBank", "#f5a623"],
  ["Halkbank", "Halkbank", "#004a93"],
  // Özel
  ["Türkiye İş Bankası", "İş Bankası", "#004b93"],
  ["Garanti BBVA", "Garanti", "#00a13a"],
  ["Yapı Kredi", "Yapı Kredi", "#004b8d"],
  ["Akbank", "Akbank", "#e2001a"],
  ["QNB Türkiye", "QNB", "#7b2c8f"],
  ["DenizBank", "DenizBank", "#0069b4"],
  ["TEB", "TEB", "#00954c"],
  ["ING Türkiye", "ING", "#ff6200"],
  ["Şekerbank", "Şekerbank", "#00953f"],
  ["Odeabank", "Odeabank", "#ed1c24"],
  ["Fibabanka", "Fibabanka", "#e30613"],
  ["Alternatif Bank", "ABank", "#c8102e"],
  ["Anadolubank", "Anadolubank", "#003f7f"],
  ["Burgan Bank", "Burgan", "#00447c"],
  ["HSBC Türkiye", "HSBC", "#db0011"],
  // Katılım
  ["Kuveyt Türk", "Kuveyt Türk", "#00693c"],
  ["Albaraka Türk", "Albaraka", "#00a5a0"],
  ["Türkiye Finans", "T. Finans", "#0b4ea2"],
  ["Vakıf Katılım", "Vakıf Katılım", "#00a0a0"],
  ["Ziraat Katılım", "Ziraat Katılım", "#c8102e"],
  ["Emlak Katılım", "Emlak Katılım", "#005baa"],
  // Dijital
  ["Enpara.com", "Enpara", "#7b2c8f"],
  ["CEPTETEB", "CEPTETEB", "#00954c"],
  ["Papara", "Papara", "#00e0b0"],
  ["Tosla", "Tosla", "#ff4d4d"],
  ["Param", "Param", "#ff6b00"],
  ["İninal", "İninal", "#f7941e"],
  ["Getir Finans", "Getir Finans", "#5d3ebc"],
  ["Nakit / Elden", "Nakit", "#64748b"],
];

const insertInstitution = sqlite.prepare(
  "INSERT INTO institutions (name, short_name, color, sort_order) VALUES (?, ?, ?, ?)",
);
const findInstitution = sqlite.prepare(
  "SELECT id FROM institutions WHERE name = ?",
);

let institutionCount = 0;
INSTITUTIONS.forEach(([name, short, color], i) => {
  if (!findInstitution.get(name)) {
    insertInstitution.run(name, short, color, i);
    institutionCount++;
  }
});
console.log(`✓ ${institutionCount} kurum eklendi (toplam ${INSTITUTIONS.length})`);

/* ──────────────────────────── Kategori ağacı ───────────────────────────── */

type CatDef = {
  name: string;
  icon: string;
  color: string;
  essential?: boolean;
  children?: Array<{ name: string; essential?: boolean }>;
};

const EXPENSE_TREE: CatDef[] = [
  {
    name: "Market & Gıda",
    icon: "shopping-cart",
    color: "#16a34a",
    essential: true,
    children: [
      { name: "Market", essential: true },
      { name: "Manav & Kasap", essential: true },
      { name: "Su & Damacana", essential: true },
      { name: "Tütün & Alkol" },
    ],
  },
  {
    name: "Yeme & İçme",
    icon: "utensils",
    color: "#f97316",
    children: [
      { name: "Restoran" },
      { name: "Kafe" },
      { name: "Online Sipariş" },
      { name: "İş Yemeği" },
    ],
  },
  {
    name: "Konut",
    icon: "home",
    color: "#0ea5e9",
    essential: true,
    children: [
      { name: "Kira", essential: true },
      { name: "Aidat", essential: true },
      { name: "Elektrik", essential: true },
      { name: "Su", essential: true },
      { name: "Doğalgaz", essential: true },
      { name: "İnternet", essential: true },
      { name: "Ev Bakım & Tadilat" },
    ],
  },
  {
    name: "Ulaşım",
    icon: "car",
    color: "#8b5cf6",
    essential: true,
    children: [
      { name: "Yakıt", essential: true },
      { name: "Toplu Taşıma", essential: true },
      { name: "Taksi & Transfer" },
      { name: "Otopark" },
      { name: "HGS / OGS", essential: true },
      { name: "Araç Bakım & Lastik" },
      { name: "Araç Sigortası", essential: true },
      { name: "MTV & Muayene", essential: true },
    ],
  },
  {
    name: "İletişim",
    icon: "smartphone",
    color: "#06b6d4",
    essential: true,
    children: [
      { name: "Cep Telefonu", essential: true },
      { name: "Sabit Hat" },
    ],
  },
  {
    name: "Sağlık",
    icon: "heart-pulse",
    color: "#ef4444",
    essential: true,
    children: [
      { name: "Eczane", essential: true },
      { name: "Doktor & Hastane", essential: true },
      { name: "Diş" },
      { name: "Sağlık Sigortası", essential: true },
      { name: "Spor & Fitness" },
    ],
  },
  {
    name: "Abonelikler",
    icon: "repeat",
    color: "#ec4899",
    children: [
      { name: "Dijital Abonelik" },
      { name: "Yazılım & Bulut" },
      { name: "Dergi & Gazete" },
    ],
  },
  {
    name: "Alışveriş",
    icon: "shopping-bag",
    color: "#a855f7",
    children: [
      { name: "Giyim & Ayakkabı" },
      { name: "Elektronik" },
      { name: "Ev Eşyası" },
      { name: "Kitap & Kırtasiye" },
      { name: "Hediye" },
    ],
  },
  {
    name: "Kişisel Bakım",
    icon: "scissors",
    color: "#f59e0b",
    children: [{ name: "Kuaför & Berber" }, { name: "Kozmetik" }],
  },
  {
    name: "Eğlence",
    icon: "clapperboard",
    color: "#d946ef",
    children: [
      { name: "Sinema & Tiyatro" },
      { name: "Konser & Etkinlik" },
      { name: "Oyun" },
      { name: "Hobi" },
    ],
  },
  {
    name: "Eğitim",
    icon: "graduation-cap",
    color: "#3b82f6",
    children: [{ name: "Kurs & Sertifika" }, { name: "Okul & Servis" }],
  },
  {
    name: "Seyahat",
    icon: "plane",
    color: "#14b8a6",
    children: [{ name: "Uçak & Otobüs" }, { name: "Konaklama" }, { name: "Tatil" }],
  },
  {
    name: "Finansal Giderler",
    icon: "landmark",
    color: "#64748b",
    essential: true,
    children: [
      { name: "Kredi Kartı Faizi", essential: true },
      { name: "KMH / Ek Hesap Faizi", essential: true },
      { name: "Kredi Faizi", essential: true },
      { name: "Banka Masrafı & Aidat", essential: true },
      { name: "Vergi & Harç", essential: true },
      { name: "Havale / EFT Ücreti" },
    ],
  },
  {
    name: "Aile & Evcil Hayvan",
    icon: "users",
    color: "#22c55e",
    children: [{ name: "Çocuk" }, { name: "Evcil Hayvan" }, { name: "Aile Desteği" }],
  },
  { name: "Bağış & Yardım", icon: "hand-heart", color: "#10b981" },
  { name: "Diğer", icon: "circle-ellipsis", color: "#94a3b8" },
];

const INCOME_TREE: CatDef[] = [
  {
    name: "Maaş",
    icon: "wallet",
    color: "#16a34a",
    children: [{ name: "Ana Maaş" }, { name: "Prim & İkramiye" }, { name: "Mesai" }],
  },
  {
    name: "Ek Gelir",
    icon: "trending-up",
    color: "#0ea5e9",
    children: [{ name: "Freelance" }, { name: "Kira Geliri" }, { name: "Satış" }],
  },
  {
    name: "Yatırım Geliri",
    icon: "chart-line",
    color: "#8b5cf6",
    children: [{ name: "Faiz" }, { name: "Temettü" }, { name: "Kur / Altın Kazancı" }],
  },
  { name: "İade & Geri Ödeme", icon: "undo", color: "#f59e0b" },
  { name: "Hediye & Destek", icon: "gift", color: "#ec4899" },
  { name: "Diğer Gelir", icon: "circle-plus", color: "#94a3b8" },
];

const findCategory = sqlite.prepare(
  "SELECT id FROM categories WHERE name = ? AND kind = ? AND (parent_id IS ? OR parent_id = ?)",
);
const insertCategory = sqlite.prepare(
  `INSERT INTO categories (name, parent_id, kind, icon, color, is_essential, sort_order)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);

function upsertCategory(
  name: string,
  parentId: number | null,
  kind: string,
  icon: string | null,
  color: string,
  essential: boolean,
  order: number,
): number {
  const found = findCategory.get(name, kind, parentId, parentId) as
    | { id: number }
    | undefined;
  if (found) return found.id;
  const res = insertCategory.run(
    name,
    parentId,
    kind,
    icon,
    color,
    essential ? 1 : 0,
    order,
  );
  return Number(res.lastInsertRowid);
}

let categoryCount = 0;
function seedTree(tree: CatDef[], kind: string) {
  tree.forEach((parent, pi) => {
    const before = categoryCount;
    const parentId = upsertCategory(
      parent.name,
      null,
      kind,
      parent.icon,
      parent.color,
      parent.essential ?? false,
      pi,
    );
    categoryCount += categoryCount === before ? 1 : 0;

    parent.children?.forEach((child, ci) => {
      upsertCategory(
        child.name,
        parentId,
        kind,
        parent.icon,
        parent.color,
        child.essential ?? parent.essential ?? false,
        ci,
      );
      categoryCount++;
    });
  });
}

seedTree(EXPENSE_TREE, "gider");
seedTree(INCOME_TREE, "gelir");
upsertCategory("Hesaplar Arası Transfer", null, "transfer", "arrow-right-left", "#64748b", false, 0);
upsertCategory("Kredi Kartı Ödemesi", null, "transfer", "credit-card", "#64748b", true, 1);

console.log(`✓ Kategori ağacı hazır (${categoryCount} kategori işlendi)`);

sqlite.exec("COMMIT");
committed = true;

} finally {
  rollbackOnFailure();
  sqlite.close();
}

/* ─────────────────────────────── Özet ──────────────────────────────────── */

console.log("\n─────────────────────────────────────────");
if (generatedPassword) {
  console.log(`  Kullanıcı adı : ${username}`);
  console.log(`  ŞİFRE         : ${generatedPassword}`);
  console.log("  Bu şifre bir daha gösterilmeyecek, kaydedin.");
} else {
  console.log(`  Kullanıcı adı : ${username}`);
  console.log("  Şifre         : belirlediğiniz ADMIN_PASSWORD");
}
console.log("─────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("Seed başarısız:", err);
  process.exit(1);
});
