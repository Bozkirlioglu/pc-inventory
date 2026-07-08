# PC Envanter (pc-inventory)

PC kurulum ve değişim (rollout) projelerinde sahada envanter kaydı toplamak için geliştirilmiş,
mobil uyumlu, internete açık çalışabilen hafif bir web uygulaması.

Teknisyen telefonundan veya bilgisayarından giriş yapar, listeden kullanıcıyı seçer
(yeni PC adı, desktop bilgisi ve seri numarası bilgileri otomatik gelir), eski PC seri
numarasını elle yazar veya telefon kamerasıyla OCR metin okuma yapar, yeni PC seri
numarasını elle yazarak **veya telefon kamerasıyla barkod okutarak** girer ve kaydeder.

## Neler yapabilir?

### Kayıt toplama
- 📋 Arama destekli kullanıcı seçimi — personel listesi önceden yüklenir, teknisyen isim yazarak bulur
- 🖥️ Yeni PC adı, desktop işareti ve (önceden yüklendiyse) eski/yeni PC seri numarası kullanıcı seçilince otomatik dolar
- 📷 **Eski PC seri no için OCR** — barkodsuz etiketlerde telefon kamerasıyla metin okur; sonuç formda düzenlenebilir
- 📷 **Barkodla yeni PC seri no girişi** — telefon kamerasıyla Code 128, Code 39/93, EAN, UPC, ITF, QR ve DataMatrix okur; elle giriş her zaman mümkün
- ✅ **Desktop** işaretli kayıtlar listede yeşil (`#77DD77`) arka planla vurgulanır; formda checkbox işaretlenince sayfa arka planı da yeşile döner
- 📝 **#TODO** alanı — kayıt başına çok satırlı yapılacaklar notu (Not alanının üzerinde)
- 🔁 Yeni seri numarasında mükerrer kayıt engeli
- 📱 Mobil uyumlu arayüz — saha kullanımı için tasarlandı

### Yönetim
- 📥 Personel listesini CSV ile toplu yükleme (`Ad Soyad;Eski PC Adı;Yeni PC Adı;Departman;Desktop;Eski PC Seri No;Yeni PC Seri No` — `;` veya `,` ayraçlı, mükerrerler otomatik atlanır; boş alanlar yüklemeyi durdurmaz; Desktop sütununda `1/0`, `evet/hayır` veya `true/false` yazılabilir)
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
4. **Yeni Kayıt** sayfasında kullanıcıyı seçin — yeni PC adı, desktop işareti ve seri no bilgileri
   (CSV'de yüklendiyse) otomatik dolar. Eski seri numarasını elle veya 📷 Metin Oku butonuyla,
   yeni seri numarasını elle veya 📷 Okut butonuyla barkod okutarak girin; gerekiyorsa #TODO ve Not alanlarını doldurun.
5. **Kayıtlar** sayfasından arayın, CSV olarak dışa aktarın.

## Canlıya alma (production)

- HTTPS/SSL sonlandırmayı reverse proxy yapar; uygulama HTTP dinler.
  `.env` içinde `NODE_ENV=production` açın (oturum çerezi `Secure` işaretlenir).
- ⚠️ **Kamera özellikleri için HTTPS şarttır** — tarayıcılar barkod ve OCR kamera erişimine yalnızca güvenli bağlantıda izin verir.
- Süreç yöneticisi önerilir (pm2, systemd, NSSM) — uygulama çökerse otomatik yeniden başlar.
- Oturumlar MySQL'de tutulduğu için uygulama yeniden başlatıldığında kullanıcılar atılmaz.

## Sürümler

Sürüm geçmişi için [CHANGELOG.md](CHANGELOG.md) dosyasına bakın.

## Lisans

[Apache 2.0](LICENSE)
