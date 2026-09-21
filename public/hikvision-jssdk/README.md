# Hik-Connect JSSDK (live / playback)

HikCentral Connect OpenAPI vrací **ezopen://** URL a **stream token** — přehrávání vyžaduje oficiální **JSSDK** z Hikvision Developer Kit (Hik-Connect for Teams).

1. Stáhněte JSSDK z Hikvision Developer Portal (OpenAPI balíček).
2. Zkopírujte soubory SDK sem (typicky `ezuikit.js` a závislosti dle dokumentace).
3. Nebo nastavte na Vercelu `NEXT_PUBLIC_HIKCONNECT_JSSDK_URL` na URL hostovaného skriptu (bez API Secret).

API Secret nikdy nepatří do prohlížeče.
