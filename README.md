# ListFlow

Etsy listing otomasyonu. İki giriş yolu var:

1. **Tasarım yükle** — Claude görseli analiz eder (konu, stil, renk paleti, tipografi) ve buradan başlık/açıklama/etiket üretir.
2. **Google Sheet** — A sütunundaki niş başlıklarını çeker, toplu üretir, isterseniz sonuçları aynı satırlara geri yazar.

Üçüncü bir sekme (Tek niş) sheet'e gerek kalmadan elle niş girmek için.

Çıktı Etsy'nin gerçek limitlerine göre normalize edilir: başlık ≤140 karakter (kelime ortasından kesmeden), 13 etiket × ≤20 karakter, tekrarlar temizlenir, malzemeler ≤45 karakter.

## Kurulum

```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY'i doldurun
npm run dev
```

http://localhost:3000

### Google Sheets (opsiyonel)

Sadece sheet sekmesi için gerekli; tasarım ve tek-niş sekmeleri onsuz çalışır.

1. Google Cloud'da bir proje açın, **Google Sheets API**'yi etkinleştirin.
2. Bir **servis hesabı** oluşturun ve JSON anahtarını indirin.
3. JSON'daki `client_email` ve `private_key` değerlerini `.env.local` içine yazın (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`).
4. Sheet'i o servis hesabı e-postasıyla paylaşın — geri yazma istiyorsanız **Editor**, sadece okuma için **Viewer** yeterli.

Sheet düzeni:

| A (niş) | B (bağlam, opsiyonel) | C | D | E |
|---|---|---|---|---|
| boho pampas wall art printable | dijital indirme, 24x36 | ← başlık | ← açıklama | ← etiketler |

C–E sütunları sadece "Sonuçları sheet'e geri yaz" işaretliyse doldurulur.

## API

| Endpoint | Ne yapar |
|---|---|
| `POST /api/analyze` | multipart: `design` (görsel), `context`, `language` → tek listing |
| `POST /api/generate` | JSON: `{ niche, context?, language? }` → tek listing |
| `GET /api/sheets?spreadsheetId=&range=` | Sheet'teki nişleri önizler |
| `POST /api/sheets` | `{ spreadsheetId, range, limit, language, writeBack }` → toplu üretim |

Toplu üretim aynı anda 3 istek çalıştırır (rate limit için). Bir satır başarısız olursa diğerleri devam eder; hata o satırın yanında görünür.

## Yapı

```
src/lib/etsy.ts       Etsy limitleri, normalizasyon, kalite uyarıları
src/lib/listing.ts    Claude prompt'ları + structured output şeması
src/lib/sheets.ts     Google Sheets okuma/yazma
src/lib/anthropic.ts  API istemcisi
src/app/api/*         Route handler'lar
src/app/page.tsx      UI (3 sekme)
```

Model varsayılanı `claude-opus-5`; `LISTFLOW_MODEL` ile değiştirilebilir.

## Notlar

- Model ölçü, kargo süresi, lisans koşulu gibi doğrulanamayan detayları uydurmaması için sistem prompt'unda kısıtlandı — bu alanları listelemeden önce kendiniz kontrol edin.
- Türkçe seçildiğinde metin Türkçe, **etiketler İngilizce** üretilir; Etsy alıcı tabanı İngilizce arıyor.
- Etiket sayısı 13'ün altında kalırsa veya başlık kısa çıkarsa UI uyarı gösterir.
