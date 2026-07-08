# Değişiklik Günlüğü

Bu proje [Semantic Versioning](https://semver.org/lang/tr/) kurallarını izler.

## [Unreleased]

### Eklenenler
- Eski PC seri numarası için telefon kamerasından OCR ile metin okuma eklendi; okunan değer kaydetmeden önce formda kontrol edilebilir.
- Personel CSV import formatı `Ad Soyad;Eski PC Adı;Yeni PC Adı;Departman;Desktop;Eski PC Seri No;Yeni PC Seri No` olarak genişletildi.
- Personel ve kayıt şemasına `new_pc_name`; personel şemasına ön-yüklenebilir `old_pc_serial` alanı eklendi.

### Değişenler
- Kayıt formunda otomatik dolan PC adı alanı artık arayüzde `Yeni PC Adı` olarak gösterilir; `old_pc_name` veritabanında korunur.
- CSV importta boş alanlar yüklemeyi durdurmaz; ad soyadı boş satırlar atlanır.

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

[1.0.1]: https://github.com/Bozkirlioglu/pc-inventory/releases/tag/v1.0.1
[1.0.0]: https://github.com/Bozkirlioglu/pc-inventory/releases/tag/v1.0.0
