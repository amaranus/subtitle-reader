# Subtitle Reader

YouTube videolarındaki altyazıları, tarayıcının TTS motoru veya bilgisayarınızda çalışan yerel **SuperTonic** sunucusu ile seslendiren bir Chrome/Brave uzantısı.

*amaranus tarafından yaratıldı.*

## Özellikler

- YouTube altyazılarını canlı okur (otomatik/harici altyazılar)
- İki seslendirme motoru:
  - **Tarayıcı**: PC'nizde yüklü sistem TTS sesleri (Windows/macOS/Linux sesleri)
  - **SuperTonic**: Yerel `ws://127.0.0.1:8765` sunucusu (10 ses: F1–F5, M1–M5;31 dil, Türkçe dahil)
- Cümle/nokta-virgül bazlı okuma: kelimeler tamamlanmadan okuma başlamaz, tekrar yok
- Senkron kontrolü (video ↔ ses):
  - **Kapalı**: senkronsuz okuma
  - **Yakala**: geride kalınca ses hızlanır (1.25×/1.5×)
  - **Videoyu yavaşlat**: geride kalınca video kademeli yavaşlar (0.75× → 0.5× → duraklat)
  - **İkisi birden**: her ikisi
- Manuel senkron kaydırması: **−2 sn … +2 sn** (negatif = daha erken, pozitif = daha geç okur)
- Ses hızı: 0.5×–2×
- Sürekli senkron düzeltmesi: parça sonu sessizlikleri otomatik kırpılır, lag >1 sn'de ses hafif hızlanıp yakalar

## Gereksinimler

- Chrome veya Brave (Manifest V3)
- SuperTonic modu için: [thanhng8/supertonic-tool](https://github.com/thanhng8/supertonic-tool) sunucusunun `ws://127.0.0.1:8765` adresinde çalışıyor olması (tarayıcı modunda gerekmez)

## Kurulum

1. Bu depoyu klonlayın veya ZIP olarak indirip çıkarın
2. `chrome://extensions` (Brave: `brave://extensions`) adresini açın
3. **Geliştirici modu**'nu açın
4. **Paketlenmemiş uzantıyı yükle**'yi seçin ve bu klasörü gösterin
5. (İsteğe bağlı) SuperTonic sunucusunu başlatın

## Kullanım

1. YouTube'da bir video açın (altyazılar açık olmalı)
2. Araç çubuğundaki uzantı simgesine tıklayın
3. **Başlat**'a basın; altyazılar okunmaya başlar. **Durdur** ile bitirirsiniz
4. Ayarlar (canlı uygulanır, sayfa yenileme gerekmez):
   - **Seslendirme motoru**: Tarayıcı (sistem sesi seçimi) veya SuperTonic (ses + dil)
   - **Ses hızı**: slider
   - **Senkron**: Kapalı / Yakala / Videoyu yavaşlat / İkisi birden
   - **Senkron kaydırması**: −2 … +2 sn
5. Videoyu kendiniz duraklatırsanız ses de duraklar; senkron sistemi bunu "geride kalma" saymaz
6. Videoyu ileri/geri sarmak okumayı sıfırlar ve yeni konumdan devam eder

## Nasıl çalışır

| Dosya | Görev |
|---|---|
| `manifest.json` | MV3 tanımı; izinler: `storage`, `offscreen` |
| `popup.html/js` | Arayüz: Başlat/Durdur, ses seçimi, hız, senkron modu, offset |
| `content.js` | YouTube sayfasında altyazı DOM'unu izler; kelime örtüşmesiyle delta çıkarır, nokta/virgül/sessizlik anlarında cümle parçalarını gönderir; video senkron seviyelerini uygular |
| `background.js` | SuperTonic WebSocket bağlantısı, sentez kuyruğu, mesaj yönlendirme |
| `offscreen.html/js` | WAV oynatma kuyruğu, sessizlik kırpma, lag ölçümü, hız telafisi |
| `icon.png` | Uzantı simgesi |

**Okuma mantığı:** altyazı penceresi kelime kelime büyür/ kayar; yeni metin eskisiyle kelime bazında karşılaştırılıp **sadece yeni gelen kelimeler** biriktirilir (aynı yer asla tekrar okunmaz). Birikim; nokta/virgül (`100ms`), kısa bekleyiş (`800ms`, <3 kelime), sessizlik (`550ms`) veya320 karakter sınırında gönderilir.

**Senkron metriği:** kuyruktaki içeriğin bekleme süresi (lag). Eşikler: >3 sn → 0.75×, >6 sn → 0.5×, >9 sn → duraklat; kurtulunca normale döner. Ses tarafında lag >1 sn ise `playbackRate` 1.02–1.20× arasında artar.

## Notlar

- Uzantı değişikliğinde `chrome://extensions`'tan yeniden yükleyin ve YouTube sekmesini yenileyin
- SuperTonic modunda sentez gecikmesi (~1 sn) dahili olarak hız telafisi ile dengelenir
- Yalnızca YouTube'da çalışır (`content_scripts` eşleşmesi)

## Lisans & Telif

amaranus tarafından yaratıldı. Apache 2.0
