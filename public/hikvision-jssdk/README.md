# Hik-Connect / EZUIKit JSSDK (live & playback)

HikCentral Connect OpenAPI vrací **ezopen://** URL a **stream token**. Přehrávání v prohlížeči vyžaduje oficiální **EZUIKit** z Hikvision Developer Kit (Hik-Connect for Teams) nebo z balíčku [ezuikit-js](https://www.npmjs.com/package/ezuikit-js) (UMD build).

## Co zkopírovat do `public/hikvision-jssdk/`

Z distribuce Developer Kit / npm balíčku `ezuikit-js` (složka `ezuikit` nebo `dist`):

| Soubor / složka | URL v prohlížeči |
|-----------------|------------------|
| `ezuikit.js` | `/hikvision-jssdk/ezuikit.js` |
| `ezuikit.css` (pokud je v balíčku) | `/hikvision-jssdk/ezuikit.css` |
| celá složka `ezuikit_static/` (wasm, decoder, workers) | `/hikvision-jssdk/ezuikit_static/` |

**Pozor na velikost písmen:** na Linuxu / Vercelu platí cesta **`ezuikit.js`** (malé „u“). `ezUIKit.js` bez souboru vrátí 404.

Globální API po načtení UMD: `window.EZUIKit.EZUIKitPlayer`.

## Volitelné env (Vercel)

Pouze pokud SDK nehostujete lokálně:

- `NEXT_PUBLIC_HIKCONNECT_JSSDK_URL` — plná URL k `ezuikit.js` (oficiální hosting, který kontrolujete)
- `NEXT_PUBLIC_HIKCONNECT_JSSDK_CSS_URL` — CSS (volitelné)
- `NEXT_PUBLIC_HIKCONNECT_JSSDK_STATIC_PATH` — veřejná cesta ke `static` assets (výchozí `/hikvision-jssdk/ezuikit_static`)

**API Secret a Hikvision credentials nikdy do `NEXT_PUBLIC_*`.**

## Diagnostika

V **Nastavení → Hikvision** spusťte diagnostiku Hik-Connect Cloud (admin). Kontroluje i existenci lokálních souborů JSSDK na serveru.
