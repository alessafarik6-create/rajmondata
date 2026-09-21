# Hik-Connect / EZUIKit JSSDK (live & playback)

Oficiální **ezuikit-js** (npm) se při `npm install` / Vercel buildu kopíruje do této složky skriptem `scripts/copy-hikvision-jssdk.mjs`.

## Produkční URL

| Soubor | URL |
|--------|-----|
| `ezuikit.js` | `/hikvision-jssdk/ezuikit.js` |
| `ezUIKit.js` | `/hikvision-jssdk/ezUIKit.js` (alias z postinstall — **bez** Next redirectu, kvůli case-insensitive smyčce na Vercelu) |
| `ezuikit_static/` | `/hikvision-jssdk/ezuikit_static/` |

Globální API: `window.EZUIKit.EZUIKitPlayer`.

## Ruční override

- `NEXT_PUBLIC_HIKCONNECT_JSSDK_URL`
- `NEXT_PUBLIC_HIKCONNECT_JSSDK_STATIC_PATH` (výchozí `/hikvision-jssdk/ezuikit_static`)

API Secret nikdy do `NEXT_PUBLIC_*`.
