# ListFlow

Etsy listing otomasyonu. İki giriş yolu var:

1. **Tasarım yükle** — Model görseli analiz eder (konu, stil, renk paleti, tipografi) ve buradan başlık/açıklama/etiket üretir. PNG, JPEG, WebP, GIF ve SVG kabul eder.
2. **Google Sheet** — Status'ü `New` olan satırları çeker, toplu üretir, sonuçları aynı satıra yazıp Status'ü `Done` yapar.

Üçüncü bir sekme (Tek niş) sheet'e gerek kalmadan elle niş girmek için.

Çıktı Etsy'nin gerçek limitlerine göre normalize edilir: başlık ≤140 karakter (kelime ortasından kesmeden), 13 etiket × ≤20 karakter, tekrarlar temizlenir, malzemeler ≤45 karakter.

## SEO kuralları

**Başlığın ilk 3-4 kelimesi.** Etsy başlığın başını en ağır tartar, o yüzden ilk 3-4 kelime müşterinin arama kutusuna yazacağı ifade olmalı — marka adı, "Beautiful"/"Unique" gibi sıfatlar ve dolgu kelimeler sonraya kalır.

Bunu sadece prompt'a bırakmıyoruz. Etsy'nin indeksini okuyamayız ama modelin kendi kararını kendisiyle karşılaştırabiliriz: açılış kelimeleri gerçekten arama terimiyse, modelin seçtiği etiketlerde de geçmeleri gerekir. Geçmiyorsa UI uyarı gösterir.

**Zorunlu kelimeler.** Comfort Colors ürünlerinde marka adı otomatik zorunlu olur. Terim **başlıkta, açıklamada ve en az bir etikette** geçer — Etsy bu üç alanı ayrı ayrı eşler, sadece birinde geçen terim diğer ikisinde görünmez.

Bir terim eksik çıkarsa uygulama eksiği açıkça belirten tek bir düzeltme turu atar. Terimi string olarak yamamak yerine yeniden ürettiriyoruz; yamamak anahtar kelime yığınına benzeyen bir başlık üretir. İkinci tur da tutmazsa sonuç yine dönüyor, eksik UI'da işaretleniyor.

**Etiket slotu israfı.** Zorunlu bir terim en fazla **2 etikette** geçebilir. İki varyasyon o marka aramasını zaten karşılıyor; üçüncüsü yeni bir aramaya ulaşmak yerine kendi listing'inizle yarışan bir slot demek. Aşılırsa UI uyarıyor.

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
4. Sheet'i o servis hesabı e-postasıyla **Editor** olarak paylaşın — Viewer yetkisi geri yazmaya yetmez.

**Akış:** Status'ü `New` (veya boş) olan satırlar çekilir, listing üretilir, sonuçlar yazılır ve Status `Done` olur. `Done` veya başka bir değer taşıyan satırlara dokunulmaz — yani aynı butona tekrar basmak üretilmiş satırları yeniden üretmez.

Sütunlar **başlık adından** bulunur, harf sırasından değil. Örnek düzen:

| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| Niche | Status | Design_URL | Etsy_URL | SEO_Title | Description | Tags |
| ← girdi | ← New/Done | dokunulmaz | dokunulmaz | ← yazılır | ← yazılır | ← yazılır |

Başlık isimleri esnek (`Niş`/`Durum`/`Başlık` gibi Türkçe karşılıklar da tanınır) ve tanınmayan sütunlara dokunulmaz. **Check sheet** butonu üretmeden önce hangi sütunu ne olarak algıladığını ve kaç satırın `New` olduğunu gösterir.

Başlık satırı hiç tanınmazsa sütunlar soldan sağa varsayılır (A niş, B status, C/D/E çıktı). Bir tane bile tanınan başlık varsa satır 1 başlık kabul edilir — aksi halde başlık satırı niş sanılıp "Niche" için listing üretilir ve Done işaretlenirdi.

Üretimi başarısız olan satır `New` kalır, sonraki çalıştırmada tekrar denenir. **Max rows per run** sınırı aşılırsa kalan satır sayısı bildirilir; butona tekrar basarak devam edersiniz.

## Etsy'ye taslak gönderme (opsiyonel)

Listing üretildikten sonra **4. adım** çıkar: sonucu doğrudan mağazanıza **taslak (draft)** olarak gönderir. Taslak yayında değildir, listeleme ücreti kesilmez — mockup görsellerini Etsy'de ekleyip kendiniz yayınlarsınız.

Kurulum:

1. https://www.etsy.com/developers/your-apps → uygulamanızın **Keystring** ve **Shared Secret** değerlerini alın. Etsy 9 Şubat 2026'dan beri `x-api-key` başlığında ikisini birlikte (`keystring:shared_secret`) istiyor, bu yüzden shared secret de gerekiyor.
2. Aynı sayfada **Callback URL** olarak `http://localhost:3000/api/etsy/callback` ekleyin (deploy ederseniz kendi alan adınızla aynısını ekleyin).
3. `.env.local` içine yazın — anahtarı hiçbir yere yapıştırmayın, sadece bu dosyaya:

   ```
   ETSY_KEYSTRING=...
   ETSY_SHARED_SECRET=...
   ETSY_REDIRECT_URI=http://localhost:3000/api/etsy/callback
   ```

4. Sunucuyu yeniden başlatın, 4. adımdaki **Connect to Etsy** ile mağazanızı yetkilendirin.

Bağlantı `.data/etsy-tokens.json` içinde tutulur (gitignore'da). Access token 1 saat, refresh token 90 gün geçerli; süre dolunca otomatik yenilenir, 90 günden sonra tekrar bağlanmanız istenir.

### Varyasyonlar

**Add size and colour variations** kutusunu işaretlerseniz taslak, beden × renk kombinasyonlarıyla oluşturulur (Etsy'nin `updateListingInventory` ucu, taslak açıldıktan sonra ikinci bir çağrıyla).

- **Name of the first menu** — Etsy'de ilk açılır menünün adı. Varsayılan **Size and Style**, çünkü bu listingler tek ilanda birden fazla giysi taşıyor.
- **Sizes and prices** — satır başına `değer = fiyat`. Değer müşterinin seçtiği şey, o yüzden giysiyi de taşıyabilir: `Short Sleeve / 2XL = 49.91`. Etsy fiyatın **tek bir varyasyona** bağlanmasına izin veriyor; burada o varyasyon beden. Yani 2XL'in her rengi aynı fiyat.
- **Colours** — satır başına bir renk. Comfort Colors 1717'nin 24 rengi katalogda tanımlı, o blank'te hazır geliyor (`src/lib/products.ts` → `colors`). Diğer blank'lerin renk dizisi doğrulanmadığı için boş; elle yazdığınızda kaydediliyor. Kaydedilmiş bir liste varsa katalog onu **ezmez**.
- Listing fiyatı en ucuz bedene eşitlenir; Etsy bunu "from" fiyatı olarak gösterir.

Renkler serbest metin olarak gönderiliyor (Etsy'nin custom variation slotları). Comfort Colors'ın "Blue Jean", "Pepper" gibi renkleri Etsy'nin sabit renk listesinde yok, beden dizileri de blank'e göre değişiyor — bu yüzden taksonominin hazır değer listeleri bu mağazaya uymuyor.

Taslak açıldıktan sonra varyasyon çağrısı başarısız olursa taslak **silinmiyor**; panel taslağın linkini ve varyasyon hatasını birlikte gösteriyor, yoksa kimsenin haberi olmadan boşta bir taslak kalırdı.

Panelde kategori, işlem profili (processing profile), kargo profili, fiyat, adet, "who made" ve "when made" seçersiniz. Bu ayarlar **ürün bazında** tarayıcıda saklanır, her listingde tekrar girmezsiniz. Varsayılanlar: 24.99 USD, 999 adet, *I did*, *Made to order*.

### Şablon görselleri

Her listing'e giren sabit görseller (beden tablosu, yıkama talimatı, renk kartı) blank başına bir kez yüklenir; taslak oluşturulduktan sonra otomatik eklenir.

- Paneldeki **Template photos** alanından seçin. PNG, JPEG, GIF; dosya başına en fazla 20 MB.
- **İsim sırasına göre** yüklenir, o yüzden dosyaları `1-`, `2-`, `3-` diye numaralayın. Etsy ilk görseli aramada çıkan küçük resim olarak kullanıyor.
- Etsy listing başına 10 görsele izin veriyor; 10'dan fazlası kabul edilmiyor.
- Dosyalar `.data/templates/<blank-id>/` altında tutuluyor (gitignore'da). Dosya adları tarayıcıdan geldiği için yeniden kurgulanıyor — `../` içeren bir ad klasörün dışına çıkamaz.

Görsel yükleme taslak oluştuktan sonra çalıştığı için, yükleme yarıda kalırsa taslak yine duruyor: panel kaç görselin gittiğini ve hatayı gösteriyor.

Notlar:

- Baskıyı bir print partner yapıyorsa Etsy "Another company or person" bekler ve partneri mağaza ayarlarında tanımlamanızı ister.
- Açıklamadaki emoji, API ile açılan taslağı Etsy arayüzünde düzenlenemez hâle getiriyor (Etsy tarafında bilinen bir hata). Bu yüzden **gönderilen** metinden emoji temizlenir; sizin kopyaladığınız metin aynı kalır.
- Etsy her fiziksel listing'in bir **processing profile**'a bağlanmasını istiyor. Profil Etsy mağaza ayarlarınızda oluşturulur; panel mevcut profilleri okuyup seçtiriyor.
- Şu an sadece Design ve Niche sekmelerinde çıkar; Google Sheet toplu üretimi hâlâ sheet'e yazar.

## API

| Endpoint | Ne yapar |
|---|---|
| `POST /api/analyze` | multipart: `design`, `productId` → tek listing |
| `POST /api/generate` | JSON: `{ niche, productId? }` → tek listing |
| `GET /api/sheets?spreadsheetId=&sheetName=` | Sütun eşleşmesini ve `New` satır sayısını döner |
| `POST /api/sheets` | `{ spreadsheetId, sheetName?, limit, writeBack, productId? }` → `New` satırları üretir |
| `GET /api/etsy/connect` | OAuth 2.0 + PKCE akışını başlatır |
| `GET /api/etsy/callback` | Etsy dönüşü; token'ları saklar |
| `GET /api/etsy/status` | Bağlantı durumu, mağaza ve kargo profilleri (`DELETE` bağlantıyı keser) |
| `GET /api/etsy/taxonomy` | Etsy kategori ağacı (Clothing dalı, günlük cache) |
| `POST /api/etsy/publish` | Listing'i taslak olarak mağazaya gönderir |
| `GET/POST/DELETE /api/etsy/templates?productId=` | Blank'in şablon görselleri |

`productId` verilmezse veya tanınmazsa ilk ürün (Comfort Colors 1717) kullanılır. `spreadsheetId` tam URL de kabul eder.

Toplu üretim aynı anda 3 istek çalıştırır (rate limit için). Bir satır başarısız olursa diğerleri devam eder; hata o satırın yanında görünür.

## Yapı

```
src/lib/etsy.ts       Etsy limitleri, normalizasyon, zorunlu kelime + açılış ifadesi + dijital terim kontrolü
src/lib/products.ts   Blank kataloğu (üretici spec'leri, kaynaklarıyla)
src/lib/listing.ts    Prompt + structured output şeması
src/lib/svg.ts        SVG → PNG rasterizer
src/lib/sheets.ts     Google Sheets okuma/yazma
src/lib/openai.ts    API istemcisi
src/lib/etsy-api.ts   Etsy Open API v3 (OAuth + PKCE, taslak oluşturma)
src/lib/etsy-tokens.ts  Etsy token deposu (.data/, otomatik yenileme)
src/app/api/*         Route handler'lar
src/app/page.tsx      UI (3 sekme)
src/app/DropZone.tsx  Sürükle-bırak dosya alanı
src/app/ListingCard.tsx  Sonuç kartı
src/lib/etsy-templates.ts  Blank başına şablon görselleri (.data/templates/)
src/app/EtsyPanel.tsx    Etsy'ye taslak gönderme paneli (4. adım)
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
- Etsy token deposu diske yazıyor; bu kendi bilgisayarınızda çalışır. Vercel'e deploy ederseniz her istek boş bir dosya sistemiyle başlar, o yüzden orada gerçek bir depo (ör. Vercel KV) gerekir — `src/lib/etsy-tokens.ts` içindeki `load`/`save` değişince gerisi aynı kalır.
- Etiket sayısı 13'ün altında kalırsa, başlık kısa çıkarsa, başlık arama ifadesiyle başlamazsa veya zorunlu bir kelime üç alandan birinde eksikse UI uyarı gösterir.
