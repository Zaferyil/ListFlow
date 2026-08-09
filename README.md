# ListFlow

Etsy listing otomasyonu. İki giriş yolu var:

1. **Tasarım yükle** — Model görseli analiz eder (konu, stil, renk paleti, tipografi) ve buradan başlık/açıklama/etiket üretir.
2. **Google Sheet** — A sütunundaki niş başlıklarını çeker, toplu üretir, isterseniz sonuçları aynı satırlara geri yazar.

Üçüncü bir sekme (Tek niş) sheet'e gerek kalmadan elle niş girmek için.

Çıktı Etsy'nin gerçek limitlerine göre normalize edilir: başlık ≤140 karakter (kelime ortasından kesmeden), 13 etiket × ≤20 karakter, tekrarlar temizlenir, malzemeler ≤45 karakter.

## SEO kuralları

**Başlığın ilk 3-4 kelimesi.** Etsy başlığın başını en ağır tartar, o yüzden ilk 3-4 kelime müşterinin arama kutusuna yazacağı ifade olmalı — marka adı, "Beautiful"/"Unique" gibi sıfatlar ve dolgu kelimeler sonraya kalır.

Bunu sadece prompt'a bırakmıyoruz. Etsy'nin indeksini okuyamayız ama modelin kendi kararını kendisiyle karşılaştırabiliriz: açılış kelimeleri gerçekten arama terimiyse, modelin seçtiği etiketlerde de geçmeleri gerekir. Geçmiyorsa UI uyarı gösterir.

**Zorunlu kelimeler (ör. Comfort Colors).** Ayarlar bölümündeki Comfort Colors kutusunu işaretleyin veya kendi terimlerinizi virgülle girin. Her terim **başlıkta, açıklamada ve en az bir etikette** geçer — Etsy bu üç alanı ayrı ayrı eşler, sadece birinde geçen terim diğer ikisinde görünmez.

Bir terim eksik çıkarsa uygulama eksiği açıkça belirten tek bir düzeltme turu atar. Terimi string olarak yamamak yerine yeniden ürettiriyoruz; yamamak anahtar kelime yığınına benzeyen bir başlık üretir. İkinci tur da tutmazsa sonuç yine dönüyor, eksik UI'da işaretleniyor.

Comfort Colors için modele markanın ne olduğu (ağır gramajlı, garment-dyed ring-spun pamuk, rahat unisex kalıp) bilgi olarak veriliyor — aksi halde ya kumaşı uyduruyor ya da etrafından dolaşıyor.

## Kurulum

```bash
npm install
cp .env.example .env.local   # OPENAI_API_KEY'i doldurun
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
| `POST /api/analyze` | multipart: `design` (görsel), `context`, `requiredKeywords` (virgülle) → tek listing |
| `POST /api/generate` | JSON: `{ niche, context?, requiredKeywords? }` → tek listing |
| `GET /api/sheets?spreadsheetId=&range=` | Sheet'teki nişleri önizler |
| `POST /api/sheets` | `{ spreadsheetId, range, limit, writeBack, requiredKeywords? }` → toplu üretim |

`requiredKeywords` en fazla 5 terim alır.

Toplu üretim aynı anda 3 istek çalıştırır (rate limit için). Bir satır başarısız olursa diğerleri devam eder; hata o satırın yanında görünür.

## Yapı

```
src/lib/etsy.ts       Etsy limitleri, normalizasyon, zorunlu kelime + açılış ifadesi kontrolü
src/lib/listing.ts    Prompt + structured output şeması
src/lib/sheets.ts     Google Sheets okuma/yazma
src/lib/openai.ts    API istemcisi
src/app/api/*         Route handler'lar
src/app/page.tsx      UI (3 sekme)
```

## Model

OpenAI Chat Completions + strict JSON schema kullanılıyor; şema sabit olduğu için çıktı her zaman aynı alanlarla geliyor.

Varsayılan `gpt-5.4`. `OPENAI_MODEL` ile değiştirebilirsiniz — vision ve strict JSON schema destekleyen herhangi bir model çalışır. Aynı prompt ile ölçtüğüm süreler:

| Model | Süre | Not |
|---|---|---|
| `gpt-5.4` | ~6-8 sn | Varsayılan; temiz çıktı |
| `gpt-5.4-mini` | ~3 sn | Toplu iş için; başlıkta hafif tekrar eğilimi |
| `gpt-5.5` | ~26 sn | Bu görevde ek kazanç görmedim |

## Notlar

- Model ölçü, kargo süresi, lisans koşulu gibi doğrulanamayan detayları uydurmaması için sistem prompt'unda kısıtlandı — bu alanları listelemeden önce kendiniz kontrol edin.
- Listing çıktısı her zaman **İngilizce** ve ABD pazarına göre yazılır (Amerikan imlası, ABD beden/ölçü alışkanlıkları). Arayüz Türkçe.
- Etiket sayısı 13'ün altında kalırsa, başlık kısa çıkarsa, başlık arama ifadesiyle başlamazsa veya zorunlu bir kelime üç alandan birinde eksikse UI uyarı gösterir.
