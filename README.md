# PC Envanter (pc-inventory)

PC kurulum ve değişim (rollout) projelerinde sahada envanter kaydı toplamak için geliştirilmiş,
mobil uyumlu, internete açık çalışabilen hafif bir web uygulaması.

Teknisyen telefonundan veya bilgisayarından giriş yapar, listeden kullanıcıyı seçer
(yeni PC adı, cihaz tipi ve seri numarası bilgileri otomatik gelir), eski PC seri
numarasını elle yazar veya **etiketin fotoğrafını çekip OCR ile okutur**, yeni PC seri
numarasını elle yazarak **veya telefon kamerasıyla barkod okutarak** girer ve kaydeder.

## Neler yapabilir?

### Kayıt toplama
- 📋 Arama destekli kullanıcı seçimi — personel listesi önceden yüklenir, teknisyen **numara veya isim** yazarak bulur; liste numaraya göre artan sıralanır ve seçim "Numara - İsim" olarak gösterilir
- 🖥️ Yeni PC adı, cihaz tipi ve (önceden yüklendiyse) eski/yeni PC seri numarası kullanıcı seçilince otomatik dolar
- 🟥 Yeni PC seri no doluysa alan mat kırmızı (`#FF6666`) kutuyla vurgulanır (dolu olduğunu belli eder)
- 📷 **Eski PC seri no için fotoğraftan OCR** — telefonun kamera uygulamasıyla etiket fotoğrafı çekilir, seri numarası tarayıcıda okunur; birden fazla aday bulunursa doğru değer dokunarak seçilir, sonuç formda düzenlenebilir
- 📷 **Barkodla yeni PC seri no girişi** — telefon kamerasıyla Code 128, Code 39/93, EAN, UPC, ITF, QR ve DataMatrix okur; canlı tarayıcının tutmadığı zor barkodlar için 🖼️ Foto ile fotoğraf çekip çözme yedeği vardır; elle giriş her zaman mümkün
- ✅ **Cihaz tipi** (Desktop / Notebook / VDI) radio ile seçilir; seçime göre form ve kayıt listesi renklenir — Desktop yeşil (`#77DD77`), Notebook camgöbeği (`#24ffff`), VDI beyaz
- 📝 **#TODO** alanı — kayıt başına çok satırlı yapılacaklar notu (Not alanının üzerinde)
- 🔁 Yeni seri numarasında mükerrer kayıt engeli
- 📱 Mobil uyumlu arayüz — saha kullanımı için tasarlandı

### Yönetim
- 📥 Personel listesini CSV ile toplu yükleme (`Numara;Ad Soyad;Eski PC Adı;Yeni PC Adı;Departman;Desktop;Eski PC Seri No;Yeni PC Seri No` — `;` veya `,` ayraçlı, mükerrerler otomatik atlanır; boş alanlar yüklemeyi durdurmaz; **Numara** boşsa son numaradan otomatik artar, Numara sütunu olmayan eski dosyalar da yüklenir; Desktop sütununa cihaz tipi `D`/`N`/`V` yazılır, boş=Notebook — eski `1`/`0` de kabul edilir)
- ⚙️ **Ayarlanabilir doğrulama kuralları**: hangi alanların zorunlu olduğu ve biçim desenleri (regex) kod değişikliği gerektirmeden yönetim panelinden belirlenir; varsayılan olarak hiçbir alan zorunlu değildir
- 👥 Rol tabanlı hesaplar: **admin** (yönetim + silme) ve **teknisyen** (kayıt girme/listeleme)
- 🔍 Kayıtlarda isim, PC adı veya seri no ile arama
- 📤 Excel uyumlu CSV dışa aktarma (UTF-8 BOM, `;` ayraçlı — Türkçe karakterler bozulmaz)

### Güvenlik
- 🔐 Oturum tabanlı giriş (bcrypt ile şifre saklama), oturumlar MySQL'de tutulur
- 🛡️ Login brute-force koruması: IP başına 5 hatalı denemede 5 dakika kilit
- 🌐 Reverse proxy (nginx/IIS/Caddy) arkasında çalışmaya hazır: `trust proxy` açık, production'da `Secure` cookie

## Teknoloji

| Katman | Seçim |
|---|---|
| Sunucu | Node.js 18+, Express |
| Görünüm | EJS (sunucu taraflı render — SPA/build adımı yok) |
| Veritabanı | MySQL 8 (`mysql2`, connection pool; tablolar ilk çalıştırmada otomatik oluşur) |
| Barkod | [html5-qrcode](https://github.com/mebjas/html5-qrcode) (lokal servis edilir, CDN bağımlılığı yok) |
| OCR | [Tesseract.js](https://tesseract.projectnaptha.com/) + yerel `eng` dil verisi (tarayıcıda çalışır; sunucu GPU gerektirmez) |

## Kurulum

1. MySQL'de veritabanı ve kullanıcı oluşturun:

   ```sql
   CREATE DATABASE pc_envanter CHARACTER SET utf8mb4 COLLATE utf8mb4_turkish_ci;
   CREATE USER 'pc_envanter'@'localhost' IDENTIFIED BY 'guclu-bir-sifre';
   GRANT ALL PRIVILEGES ON pc_envanter.* TO 'pc_envanter'@'localhost';
   ```

2. Bağımlılıkları yükleyin ve ayar dosyasını hazırlayın:

   ```bash
   npm install
   cp .env.example .env    # Windows: copy .env.example .env
   ```

   `.env` içindeki veritabanı bilgilerini ve `SESSION_SECRET` değerini doldurun.

3. Başlatın:

   ```bash
   npm start               # geliştirmede: npm run dev
   ```

   Tablolar ilk çalıştırmada otomatik oluşur. Varsayılan giriş: **admin / admin123**
   (veya `.env` içindeki `ADMIN_PASSWORD`). **İlk girişte şifreyi değiştirin.**

## Kullanım

1. **Yönetim** sayfasından personel listesini CSV ile yükleyin
   (`Ad Soyad;Eski PC Adı;Yeni PC Adı;Departman;Desktop;Eski PC Seri No;Yeni PC Seri No`).
2. Alan zorunluluklarını ve biçim desenlerini **Yönetim → Alan Kuralları**'ndan ayarlayın.
3. Teknisyen hesaplarını Yönetim sayfasından açın.
4. **Yeni Kayıt** sayfasında kullanıcıyı seçin — yeni PC adı, cihaz tipi ve seri no bilgileri
   (CSV'de yüklendiyse) otomatik dolar. Eski seri numarasını elle veya 📷 Metin Oku ile
   etiketin fotoğrafını çekerek, yeni seri numarasını elle veya 📷 Okut butonuyla barkod
   okutarak girin (barkod tutmuyorsa 🖼️ Foto ile fotoğraf çekip çözün); gerekiyorsa #TODO
   ve Not alanlarını doldurun.
5. **Kayıtlar** sayfasından arayın, CSV olarak dışa aktarın.

## Canlıya alma (production)

- HTTPS/SSL sonlandırmayı reverse proxy yapar; uygulama HTTP dinler.
  `.env` içinde `NODE_ENV=production` açın (oturum çerezi `Secure` işaretlenir).
- ⚠️ **Barkod okuma için HTTPS şarttır** — tarayıcılar canlı kamera erişimine yalnızca güvenli
  bağlantıda izin verir. Eski seri OCR'ı fotoğraf çekimiyle çalıştığı için HTTPS gerektirmez.
- Süreç yöneticisi önerilir (pm2, systemd, NSSM) — uygulama çökerse otomatik yeniden başlar.
- Oturumlar MySQL'de tutulduğu için uygulama yeniden başlatıldığında kullanıcılar atılmaz.

## Sürümler

Sürüm geçmişi için [CHANGELOG.md](CHANGELOG.md) dosyasına bakın.

## Lisans

[Apache 2.0](LICENSE)
