# ListFlow

Etsy listing otomasyonu. İki giriş yolu var:

1. **Tasarım yükle** — Model görseli analiz eder (konu, stil, renk paleti, tipografi) ve buradan başlık/açıklama/etiket üretir. PNG, JPEG, WebP, GIF ve SVG kabul eder.
2. **Google Sheet** — A sütunundaki niş başlıklarını çeker, toplu üretir, isterseniz sonuçları aynı satırlara geri yazar.

Üçüncü bir sekme (Tek niş) sheet'e gerek kalmadan elle niş girmek için.

Çıktı Etsy'nin gerçek limitlerine göre normalize edilir: başlık ≤140 karakter (kelime ortasından kesmeden), 13 etiket × ≤20 karakter, tekrarlar temizlenir, malzemeler ≤45 karakter.

## SEO kuralları

**Başlığın ilk 3-4 kelimesi.** Etsy başlığın başını en ağır tartar, o yüzden ilk 3-4 kelime müşterinin arama kutusuna yazacağı ifade olmalı — marka adı, "Beautiful"/"Unique" gibi sıfatlar ve dolgu kelimeler sonraya kalır.

Bunu sadece prompt'a bırakmıyoruz. Etsy'nin indeksini okuyamayız ama modelin kendi kararını kendisiyle karşılaştırabiliriz: açılış kelimeleri gerçekten arama terimiyse, modelin seçtiği etiketlerde de geçmeleri gerekir. Geçmiyorsa UI uyarı gösterir.

**Zorunlu kelimeler.** Comfort Colors ürünlerinde marka adı otomatik zorunlu olur; kendi terimlerinizi de virgülle ekleyebilirsiniz. Her terim **başlıkta, açıklamada ve en az bir etikette** geçer — Etsy bu üç alanı ayrı ayrı eşler, sadece birinde geçen terim diğer ikisinde görünmez.

Bir terim eksik çıkarsa uygulama eksiği açıkça belirten tek bir düzeltme turu atar. Terimi string olarak yamamak yerine yeniden ürettiriyoruz; yamamak anahtar kelime yığınına benzeyen bir başlık üretir. İkinci tur da tutmazsa sonuç yine dönüyor, eksik UI'da işaretleniyor.

## Ürünler

Üstteki butonlardan hangi blank'e bastığınızı seçiyorsunuz. Seçim üç sekmede de geçerli.

| Buton | Kumaş | Gramaj |
|---|---|---|
| Comfort Colors 1717 | %100 US ring-spun pamuk, garment-dyed | 6.1 oz |
| Gildan 64000 Softstyle | %100 preshrunk ring-spun pamuk | 4.5 oz |
| Gildan 18500 Hoodie | %50/50 pamuk/polyester | 8.0 oz |
| AWDis JH030 Sweatshirt | %80 ring-spun pamuk, %20 polyester | 280 gsm |
| Gildan 2400 Long Sleeve | %100 pamuk preshrunk jersey | 6.0 oz |
| Gildan 5000B Youth Tee | %100 pamuk | 5.3 oz |
| Comfort Colors 9018 Youth | %100 ring-spun pamuk, garment-dyed | 6.1 oz |

Bu veriler üreticinin kendi spec sheet'inden alındı, modelin hafızasından değil (kaynaklar `src/lib/products.ts` içinde her ürünün yanında). Kumaş içeriği, bir listing'de alıcının sizi bağlayabileceği tek şey — ve modelin en kolay, en inandırıcı şekilde uyduracağı detay. Prompt'a "bu spec'lere güvenebilirsin" deniyor; bu, "sana söylenmeyeni yazma" kuralını sadece bu alan için kaldırıyor.

**Etsy'nin malzeme alanı üretilmiyor**, doğrudan katalogdan geliyor. Bilinen bir gerçeği modele yazdırmanın kazancı yok, yanlış yazma riski var.

**Renk uyarısı önemli:** bu blank'lerin çoğunda kompozisyon renge göre değişiyor — Gildan 64000'de Sport Grey %90/10, heather renkler %35/65; 2400'de Dark Heather %50/50. Model bu yüzden "tüm renkler %100 pamuk" diyemiyor; ya standart renkleri anlatıp heather'ın blend olduğunu belirtiyor ya da kumaş içeriğini başlık/etiket dışında bırakıyor.

Youth ürünlerde (5000B, 9018) metin çocuğa alan yetişkine yazılıyor — ebeveyn, büyükanne, öğretmen — ve anahtar kelimeler kids/youth diline göre kuruluyor.

### SVG dosyaları

Vision modelleri SVG kabul etmiyor, o yüzden yüklenen SVG sunucuda PNG'ye çevriliyor (resvg ile — script çalıştırmaz ve dış kaynak çekmez, yüklenen dosya güvenilmez girdi olduğu için önemli).

Şeffaf zeminde bir tuzak var: cut file'lar genelde tek renk. Beyaz bir tasarımı beyaz zemine bindirirseniz modele boş görsel gitmiş olur. Bu yüzden çevirmeden önce tasarımın parlaklığı ölçülüyor ve zemin ona göre seçiliyor — koyu tasarım açık zemine, açık tasarım koyu zemine biniyor. Modele de bu zeminin sonradan eklendiği, tasarımın parçası olmadığı söyleniyor; yoksa açıklamaya "beyaz arka planlı" diye yazıyor.

Çizim üretmeyen SVG (gömülü yazı tipi eksik, dış kaynağa bağımlı) yüklenirse istek API'ye hiç gitmeden hata veriyor.

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
| retro sunset graphic tee | oversized, yaz koleksiyonu | ← başlık | ← açıklama | ← etiketler |

C–E sütunları sadece "Sonuçları sheet'e geri yaz" işaretliyse doldurulur.

## API

| Endpoint | Ne yapar |
|---|---|
| `POST /api/analyze` | multipart: `design`, `context`, `requiredKeywords` (virgülle), `productId` → tek listing |
| `POST /api/generate` | JSON: `{ niche, context?, requiredKeywords?, productId? }` → tek listing |
| `GET /api/sheets?spreadsheetId=&range=` | Sheet'teki nişleri önizler |
| `POST /api/sheets` | `{ spreadsheetId, range, limit, writeBack, requiredKeywords?, productId? }` → toplu üretim |

`requiredKeywords` en fazla 5 terim alır. `productId` verilmezse veya tanınmazsa ilk ürün (Comfort Colors 1717) kullanılır.

Toplu üretim aynı anda 3 istek çalıştırır (rate limit için). Bir satır başarısız olursa diğerleri devam eder; hata o satırın yanında görünür.

## Yapı

```
src/lib/etsy.ts       Etsy limitleri, normalizasyon, zorunlu kelime + açılış ifadesi + dijital terim kontrolü
src/lib/products.ts   Blank kataloğu (üretici spec'leri, kaynaklarıyla)
src/lib/listing.ts    Prompt + structured output şeması
src/lib/svg.ts        SVG → PNG rasterizer
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

- Katalogdaki spec'ler dışında model ürün özelliği uyduramaz. Beden tablosu, baskı yöntemi ve kargo hâlâ bilinmiyor sayılır — listelemeden önce kendiniz ekleyin.
- Arayüz ve listing çıktısı İngilizce; çıktı ABD pazarına göre yazılır (Amerikan imlası, ABD beden/ölçü alışkanlıkları).
- Etiket sayısı 13'ün altında kalırsa, başlık kısa çıkarsa, başlık arama ifadesiyle başlamazsa veya zorunlu bir kelime üç alandan birinde eksikse UI uyarı gösterir.
