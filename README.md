# MyFinance

Türkiye finans sistemine göre çalışan, kendi sunucunuzda barındırılan kişisel
finans yönetimi. Hesaplar, kredi kartları (sanal kartlar dahil), ek hesap (KMH),
taksitli alışverişler, abonelikler ve krediler tek yerde; üstüne nakit akışı
projeksiyonu ve borçtan çıkış simülasyonu.

Web tabanlıdır ve mobil öncelikli tasarlanmıştır — telefonda ana ekrana
eklendiğinde uygulama gibi açılır.

---

## Neden başka bir bütçe uygulaması değil

Genel bütçe uygulamalarının Türkiye'de çuvalladığı yerler burada birinci sınıf
vatandaş:

- **Hesap kesim ≠ son ödeme.** Kesim 25'i, ödeme ayın 5'i olan bir kartta
  harcamanın hangi ekstreye düştüğü doğru hesaplanır; ay ve yıl atlamaları dahil.
- **Taksit kuyruğu.** Bugün yapılan 12 taksitli alışveriş, önümüzdeki 12 ayın
  her birine ayrı ayrı yük biner. Sistem bu yükü ay ay gösterir.
- **Ek hesap (KMH).** Eksi bakiye, kalan limit ve faiz ayrı takip edilir.
- **Sanal kartlar.** Ana karta bağlanır; limit paylaşımı iki kez sayılmaz.
- **Asgari ödeme.** BDDK oranlarına göre hesaplanır, mevzuat değişince
  ayarlardan güncellenir.
- **Devreden borç.** Sisteme geçerken ödenmemiş bakiyenizi tek alanda girersiniz.

---

## Hızlı kurulum (Docker — önerilen)

```bash
git clone <depo-adresi> myfinance && cd myfinance

# Ortam değişkenlerini hazırlayın
cp .env.example .env
echo "AUTH_SECRET=$(openssl rand -base64 48)" >> .env
# .env içindeki ADMIN_PASSWORD ve APP_URL alanlarını doldurun

docker compose up -d --build
docker compose logs -f app     # ilk açılışta kullanıcı bilgileri burada
```

Uygulama `127.0.0.1:3000` üzerinde çalışır — dışarıya doğrudan açılmaz.

Üç servis başlar:

| Servis | Görevi |
|---|---|
| `app` | Web arayüzü |
| `worker` | 15 dakikada bir uyarı üretir, günlük özet ve TCMB kuru çeker |
| `backup` | Günlük SQLite yedeği alır (`./backups`), 30 günden eskiyi siler |

### Sunucu yeniden başladığında

Tüm servisler `restart: unless-stopped` ile tanımlıdır; Docker açılışta onları
kendiliğinden kaldırır. Tek koşul, Docker'ın kendisinin açılışta başlaması:

```bash
sudo systemctl is-enabled docker     # "enabled" dönmeli
sudo systemctl enable docker         # değilse
```

`docker compose down` ya da `stop` derseniz konteynerler kasıtlı durdurulmuş
sayılır ve yeniden başlatmada kalkmazlar; tekrar `docker compose up -d` demek
gerekir. Yalnızca `reboot` durumunda otomatik gelirler.

Açılışta Docker, `depends_on` sırasını dikkate almadan tüm konteynerleri aynı
anda kaldırır. Bu yüzden migration ve seed adımları eşzamanlılığa karşı
korumalıdır: yazma kilidi beklenir ve yeniden denenir, seed ise tek bir işlem
içinde yürür. Dört süreç aynı anda çalıştırıldığında da hepsi temiz çıkar ve
veri bozulmaz.

### Erişim

Uygulama varsayılan olarak yalnızca `127.0.0.1`'e bağlanır — yerel ağdan bile
görünmez. Üç seçeneğiniz var:

**1. Cloudflare Zero Trust tüneli (önerilen).** Tünel aynı Docker ağında
çalışır, uygulamaya `app:3000` üzerinden ulaşır; sunucuda hiçbir port dışarı
açılmaz.

1. `one.dash.cloudflare.com` → **Networks → Tunnels → Create a tunnel →
   Cloudflared**. Tünele bir ad verin.
2. Kurulum ekranındaki jetonu kopyalayın, `.env` dosyasına ekleyin:
   `TUNNEL_TOKEN=eyJ...`
3. **Public Hostname** sekmesinde alan adınızı girin; **Service** olarak
   `HTTP` ve URL olarak **`app:3000`** yazın (`localhost` değil — tünel ayrı
   bir konteynerde).
4. Başlatın:
   ```bash
   docker compose --profile tunnel up -d
   docker compose logs -f cloudflared      # "Registered tunnel connection"
   ```
5. `.env` içindeki `APP_URL`'i tünel adresinizle güncelleyin ve
   `docker compose --profile tunnel up -d` ile yeniden başlatın.

İsterseniz aynı panelden **Access → Applications** altında e-posta doğrulaması
gibi ikinci bir kimlik katmanı ekleyebilirsiniz; uygulamanın kendi şifresi buna
rağmen açık kalmalıdır.

**2. Yerel ağdan erişim.** `.env` dosyasına `BIND_ADDRESS=0.0.0.0` ekleyip
`docker compose up -d` deyin; `http://sunucu-ip:3000` açılır. Bu durumda
uygulama ev ağındaki her cihaza açıktır ve trafik şifrelenmez — yalnızca
güvendiğiniz bir ağda kullanın.

**3. Tailscale / WireGuard.** `BIND_ADDRESS=0.0.0.0` yapın ve yalnızca VPN
arayüzünden erişin.

> **Güvenlik notu.** Bu sistem tüm banka hesaplarınızın, kart limitlerinizin ve
> harcama geçmişinizin tek bir yerde toplandığı bir veri kümesi tutar. Tünel
> arkasında olsa bile şifre koruması açıktır ve kapatılmamalıdır. Tünel
> sağlayıcınızın erişim politikası (Cloudflare Access gibi) varsa ikinci bir
> katman olarak kullanın. Sayfalar arama motorlarına kapalıdır.

---

## Geliştirme kurulumu

```bash
npm install
cp .env.example .env
echo "AUTH_SECRET=$(openssl rand -base64 48)" >> .env

npm run db:migrate                          # şemayı uygula
ADMIN_PASSWORD=sifreniz npm run db:seed     # kullanıcı + banka/kategori verisi
npm run dev
```

`http://localhost:3000` adresinde açılır.

### Komutlar

| Komut | Ne yapar |
|---|---|
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` / `npm start` | Üretim derlemesi ve sunucusu |
| `npm test` | Alan mantığı ve kart defteri testleri |
| `npm run typecheck` | Tür denetimi |
| `npm run db:generate` | Şema değişikliğinden migration üretir |
| `npm run db:migrate` | Migration'ları uygular |
| `npm run build:scripts` | Yardımcı betikleri düz JS'e derler (Docker imajı bunu kullanır) |
| `npm run notify -- --dry` | Uyarıları gönderim yapmadan dener |
| `npm run worker` | Zamanlayıcıyı elle çalıştırır |

---

## Veriyi girme sırası

Sistem, veri altlığı kurulduktan sonra anlamlı çalışır. Panel ilk açılışta bu
sırayı zaten adım adım gösterir:

1. **Hesaplar** — vadesiz, birikim, döviz. Sisteme giriş anındaki bakiyeyi
   *açılış bakiyesi* olarak, o günü de *açılış tarihi* olarak girin. Ek hesap
   limitiniz varsa faiz oranıyla birlikte yazın.
2. **Kartlar** — hesap kesim ve son ödeme günü zorunlu. Ödenmemiş eski borcunuzu
   *devreden borç* alanına girin (harcamalarını tek tek girmeyecekseniz).
   Sanal kartları ana karta bağlayın.
3. **Taksitli alışverişler** — devam edenler için toplam tutar, taksit sayısı ve
   *ödenmiş taksit sayısı*. Kalan takvimi sistem kurar.
4. **Dönem içi harcamalar** — Hareketler → *Toplu ekle*. Banka ekstrenizi
   kopyalayıp yapıştırın; satırlar ayrıştırılıp onayınıza sunulur.
5. **Abonelikler**, **krediler**, **düzenli gelir/giderler** (maaş, kira).
6. **Ayarlar** — bildirim kanalını açın, döviz kurlarını kontrol edin.

Sonrasında günlük kullanım tek satırdır.

---

## Hızlı giriş

Alt çubuğun ortasındaki **+** düğmesi (masaüstünde `N` tuşu) tek satırlık giriş
açar:

| Yazdığınız | Anlamı |
|---|---|
| `250 migros` | 250 TL gider, Migros |
| `migros 250` | aynı — sıra önemsiz |
| `+8500 maaş` | gelir kaydı |
| `12000/12 vestel` | 12 taksitli alışveriş, taksit planı otomatik kurulur |
| `250 migros d-1` | dünkü harcama |
| `1.234,56 a101` | binlik ve ondalık ayraçlar Türkçe biçimde okunur |

Bir işyerini bir kez kategorilendirdiğinizde sistem bunu hatırlar; sonraki
girişlerde kategori kendiliğinden atanır. Kaydettikten sonra alan temizlenir ve
odak korunur — arka arkaya giriş yapabilirsiniz.

---

## Analizler

- **Nakit akışı takvimi** — önümüzdeki 90 gün gün gün: hangi gün ne çıkacak,
  bakiye ne zaman eksiye düşer, ek hesap limiti yeter mi.
- **Taksit yükü** — gelecek 18 ayın her birine düşen sabit taksit tutarı.
- **Kaç ayda toparlarım** — mevcut borç, taksitler ve tasarruf kapasitenizle
  borçtan çıkış simülasyonu. Çığ (en yüksek faiz önce) ve kartopu (en küçük borç
  önce) stratejileri; gelir/gider/ek ödeme varsayımlarını değiştirip senaryo
  karşılaştırabilirsiniz.
- **Acil durum fonu** — likit varlığınızın kaç ay zorunlu gideri karşıladığı.
- **Ay içi tempo** — bu tempoyla ay sonunda nereye varacağınız, geçen ayın aynı
  gününe kıyasla fark.
- Kategori dağılımı, en çok harcanan yerler, bütçe durumu, abonelik yükü,
  tasarruf oranı geçmişi.

Projeksiyonlar yalnızca **bilinen** ödemeleri içerir (ekstreler, taksitler,
abonelikler, düzenli kalemler). Günlük harcamalar dahil değildir — gerçek
bakiyeniz projeksiyon çizgisinin altında seyreder.

---

## Bildirimler

Üç kanal desteklenir ve aynı anda birden fazlası açık olabilir:

- **ntfy** — telefona anlık push. Kurulumu en basit; hesap gerektirmez.
- **Telegram** — `@BotFather`'dan bot oluşturup jetonu girin.
- **E-posta** — SMTP.

Üretilen uyarılar:

| Uyarı | Ne zaman |
|---|---|
| Kart son ödeme | Ayarladığınız gün sayısı kala (varsayılan 7/3/1/0) |
| Ödeme günü bakiye yetersiz | Bağlı hesapta ekstreyi karşılayacak para yoksa |
| Abonelik yenilemesi | Yenilemeye 2 gün kala (abonelik başına ayarlanır) |
| Abonelik için limit yetersiz | Kartla ödenen abonelikte kullanılabilir limit azsa |
| Kart limiti doluluğu | %90 (ayarlanabilir) aşılınca |
| Ek hesap kullanımı | Bakiye eksiye düştüğünde |
| Kredi taksiti | Vade yaklaşınca ve geciktiğinde |
| Günlük özet | Ayarladığınız saatte, önümüzdeki 7 günün ödemeleri |

Aynı uyarı aynı gün iki kez gönderilmez. Ayarlar sayfasından test bildirimi
gönderebilir, kuralları elle çalıştırabilirsiniz.

> ntfy.sh gibi herkese açık bir sunucu kullanıyorsanız konu (topic) adını bilen
> herkes bildirimlerinizi okuyabilir. Tahmin edilmesi zor bir ad seçin ya da
> kendi ntfy sunucunuzu çalıştırın.

---

## Yedekleme

`backup` servisi günde bir kez SQLite'ın kendi `.backup` komutuyla tutarlı kopya
alır ve `./backups` altına yazar. Elle yedek:

```bash
docker compose exec app sh -c "sqlite3 /data/myfinance.db \".backup '/data/elle-yedek.db'\""
docker compose cp app:/data/elle-yedek.db ./
```

Geri yükleme: konteyneri durdurun, yedek dosyayı `myfinance.db` olarak birime
kopyalayın, yeniden başlatın.

---

## Teknik notlar

- **Next.js 15** (App Router) + TypeScript + Tailwind v4, tek serviste hem
  arayüz hem API.
- **SQLite + Drizzle ORM.** Tek dosya, sıfır operasyon yükü, yedek = dosya
  kopyası. Şema değişiklikleri migration ile yönetilir.
- **Para birimleri kuruş cinsinden tam sayı olarak saklanır.** Finansal veride
  kayan noktalı sayı kullanılmaz.
- **Tarihler** takvim tarihi olarak (`YYYY-MM-DD`) saklanır; zaman dilimi
  `Europe/Istanbul`.
- **Çoklu para birimi** — TRY, USD, EUR, GBP ve gram altın/gümüş. TCMB döviz
  satış kuru otomatik çekilir; altın ve gümüş elle girilir.
- **Oturum** scrypt ile hashlenmiş şifre + HttpOnly JWT çerezi. Şifre
  değiştiğinde diğer cihazlardaki oturumlar düşer.
- **Grafik renkleri** renk körlüğü ayrımı ve yüzey kontrastı açısından
  doğrulanmıştır; açık ve koyu tema için ayrı seçilmiştir.

### Proje yapısı

```
src/
  db/schema.ts          veri modeli
  lib/
    money.ts            kuruş aritmetiği, Türkçe para ayrıştırma
    dates.ts            takvim tarihi yardımcıları
    statements.ts       hesap kesim / son ödeme döngüsü, asgari ödeme
    ledger.ts           bakiye ve kart borcu hesabı (saf fonksiyonlar)
    data.ts             tüm durumu tek seferde yükler
    analytics.ts        raporlama
    forecast.ts         nakit akışı, yaklaşan ödemeler, borç projeksiyonu
    parser.ts           hızlı giriş ve ekstre yapıştırma ayrıştırıcıları
    notify/             kanallar ve uyarı kuralları
  app/                  sayfalar ve sunucu aksiyonları
tests/                  alan mantığı ve kart defteri testleri
scripts/                migration, seed, bildirim, zamanlayıcı
```

Hesaplama mantığı (`ledger.ts`, `statements.ts`, `money.ts`) veritabanından
bağımsız saf fonksiyonlardır ve `npm test` ile doğrulanır.

### Çalışma imajı neden TypeScript içermiyor

`scripts/` altındaki yardımcılar (migration, seed, bildirim, zamanlayıcı) derleme
aşamasında esbuild ile düz JavaScript'e paketlenir (`dist-scripts/`). Çalışma
imajında ne TypeScript araç zinciri, ne kaynak kod, ne de `tsconfig.json`
bulunur — yalnızca `node` yeterlidir. Native olduğu için yalnızca
`better-sqlite3` paket dışında bırakılır; onu da Next'in standalone çıktısı
taşır.
