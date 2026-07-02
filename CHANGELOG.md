# Değişiklik Günlüğü

Bu proje [Semantic Versioning](https://semver.org/lang/tr/) kurallarını izler.

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

[1.0.0]: https://github.com/Bozkirlioglu/pc-inventory/releases/tag/v1.0.0
