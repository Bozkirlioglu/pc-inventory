# Değişiklik Günlüğü

Bu proje [Semantic Versioning](https://semver.org/lang/tr/) kurallarını izler.

## [Yayınlanmamış]

### Eklenenler
- Personele **Numara** (`seq_no`) alanı: 1'den başlayan artan sıra numarası. CSV ile verilebilir;
  boş bırakılırsa tablodaki son numaradan otomatik artar (boş tabloda 1'den başlar). Mevcut kayıtlar
  ilk açılışta id sırasına göre otomatik numaralanır.
- Kayıt formundaki kullanıcı listesi artık numaraya göre artan sıralanır, **numarayla da aranabilir**
  ve seçim `Numara - İsim` biçiminde gösterilir (önceki `İsim — Eski PC Adı` yerine).
- Yeni PC seri no dolu olduğunda alan **mat kırmızı** (`#FF6666`) kutuyla vurgulanır.

### Değişenler
- Kayıt kaydedilince, formda girilen güncel bilgiler (cihaz tipi + eski/yeni seri no) seçilen
  **personel satırına da yazılır**; böylece aynı kişi tekrar arandığında en son bilgilerle gelir.
  `entries` geriye dönük günlük olarak kalır. Boş bırakılan seri no personeldeki mevcut değeri silmez.
- Kayıt formunda cihaz tipi ilk açılışta **VDI** seçili gelir.
- CSV import formatı başa **Numara** sütunu ile genişletildi
  (`Numara;Ad Soyad;Eski PC Adı;Yeni PC Adı;Departman;Desktop;Eski PC Seri No;Yeni PC Seri No`);
  Numara sütunu olmayan eski dosyalar geriye dönük desteklenir.
- **Desktop** alanı üç değerli **cihaz tipine** dönüştü: **D** (Desktop), **N** (Notebook), **V** (VDI).
  Kayıt ve tekil personel formlarında checkbox yerine radio ile seçilir. Seçime göre renklenir:
  Desktop yeşil (`#77DD77`), Notebook camgöbeği (`#24ffff`), VDI beyaz. Kayıt listesinde satırlar
  aynı renklerle vurgulanır, Cihaz Tipi sütunu etiketi (Desktop/Notebook/VDI) gösterir.
- Veritabanı: `desktop` kolonu `TINYINT(1)` yerine `ENUM('D','N','V')`; eski kayıtlar otomatik
  taşınır (`1`→Desktop, `0`→Notebook).
- CSV import Desktop sütununda `D`/`N`/`V` (ve geriye dönük `1`/`0`/`evet`/`hayır`) kabul eder;
  export'ta sütun başlığı **Cihaz Tipi**, değerler etiket olarak yazılır.

## [1.0.3] - 2026-07-09

### Eklenenler
- Yeni PC seri no alanına **🖼️ Foto** düğmesi: canlı tarayıcının tutmadığı zor (yıpranmış, loş,
  küçük) barkodlar için telefonun kamera uygulamasıyla fotoğraf çekilir ve barkod fotoğraftan
  çözülür. Canlı 📷 Okut hızlı yol olarak kalır.

### Düzeltilenler
- Gizli olması gereken kamera dosya girişleri formun altında "Dosya Seç" alanları olarak
  görünüyordu (genel `input { display: block }` kuralı `hidden` özniteliğini eziyordu).
  Girişler ilgili seri no alanlarının altına taşındı; yalnızca 📷 Metin Oku / 🖼️ Foto
  düğmesine basılınca görünürler ve kapatma/başarılı okuma sonrasında tekrar gizlenirler.

## [1.0.2] - 2026-07-08

### Eklenenler
- **Eski PC seri numarası için fotoğraftan OCR**: 📷 Metin Oku düğmesi telefonun kendi kamera
  uygulamasını açar, çekilen etiket fotoğrafı tarayıcıda Tesseract.js ile okunur. Birden fazla
  aday değer bulunursa teknisyen doğru seri numarasını dokunarak seçer; okunamazsa Tekrar Çek
  ile yeni fotoğraf çekilir. Bu yol HTTPS gerektirmez ve kameranın flaşı kullanılabilir.
- Personel CSV import formatı `Ad Soyad;Eski PC Adı;Yeni PC Adı;Departman;Desktop;Eski PC Seri No;Yeni PC Seri No` olarak genişletildi.
- Personel ve kayıt şemasına `new_pc_name`; personel şemasına ön-yüklenebilir `old_pc_serial` alanı eklendi.

### Değişenler
- Kayıt formunda otomatik dolan PC adı alanı artık arayüzde `Yeni PC Adı` olarak gösterilir; `old_pc_name` veritabanında korunur.
- CSV importta boş alanlar yüklemeyi durdurmaz; ad soyadı boş satırlar atlanır.
- OCR ilk olarak canlı kamera görüntüsünden okuma olarak denendi; saha testinde küçük etiket
  yazısı video karesinden okunamadığı için fotoğraf tabanlı akışa geçildi (netleme/çözünürlük
  native kamerada çok daha iyi).

## [1.0.1] - 2026-07-03

### Eklenenler
- **Desktop** alanı: kayıt formunda checkbox; işaretlenince sayfa arka planı `#77DD77` yeşiline döner,
  kayıt listesinde desktop kayıtları aynı renkle vurgulanır
- **#TODO** alanı: kayıt başına çok satırlı yapılacaklar notu (formda Not alanının üzerinde),
  kayıt listesinde ve CSV export'ta gösterilir
- Personel CSV import formatına `Desktop` ve `Yeni PC Seri No` sütunları eklendi
  (`Ad Soyad;Eski PC Adı;Departman;Desktop;Yeni PC Seri No` — son iki sütun opsiyonel);
  kullanıcı seçilince bu bilgiler formu otomatik doldurur
- Tekil personel ekleme formuna ve personel listesine Desktop / Yeni Seri alanları eklendi
- CSV export'a `Desktop` ve `#TODO` sütunları eklendi

### Kaldırılanlar
- Eski PC Seri No alanındaki barkod okutma (📷 Okut) butonu kaldırıldı — bu alan artık yalnızca
  elle girilir; yeni PC seri no için barkod okuma sürüyor

## [1.0.0] - 2026-07-02

İlk sürüm.

### Eklenenler
- Oturum tabanlı giriş (bcrypt), admin/teknisyen rolleri, IP başına brute-force kilidi
- Kurulum kaydı formu: arama destekli kullanıcı seçimi, eski PC adı otomatik doldurma,
  eski/yeni PC seri numarası girişi
- Telefon kamerasıyla barkod okutarak seri no girişi (Code 128/39/93, EAN, UPC, ITF, QR, DataMatrix)
- Yönetim panelinden ayarlanabilir alan kuralları: zorunluluk + biçim deseni (regex),
  varsayılan olarak tüm alanlar opsiyonel
- Personel listesi CSV import (`;` veya `,` ayraçlı, mükerrer atlama) ve tekil ekleme/silme
- Kayıtlarda arama ve Excel uyumlu CSV export (UTF-8 BOM, `;` ayraçlı)
- Yeni seri numarasında mükerrer kayıt engeli
- MySQL şeması ilk çalıştırmada otomatik kurulum + idempotent migration altyapısı
- Mobil uyumlu arayüz, reverse proxy arkasında production çalıştırma desteği

[1.0.3]: https://github.com/Bozkirlioglu/pc-inventory/releases/tag/v1.0.3
[1.0.2]: https://github.com/Bozkirlioglu/pc-inventory/releases/tag/v1.0.2
[1.0.1]: https://github.com/Bozkirlioglu/pc-inventory/releases/tag/v1.0.1
[1.0.0]: https://github.com/Bozkirlioglu/pc-inventory/releases/tag/v1.0.0
