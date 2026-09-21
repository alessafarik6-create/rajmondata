# Hik-Connect for Teams — OpenAPI

RAJMONDATA používá **samostatný cloud provider** (`HIKCONNECT_OPENAPI`), ne ISAPI na LAN.

V tomto repozitáři **není** kompletní oficiální specifikace OpenAPI (base URL, podpis requestu, nonce, hash, endpointy pro zařízení/kanály/stream/playback).

## Co je implementováno

- Provider abstrakce a ukládání **API Key / API Secret** (šifrovaně server-side)
- Test / sync / live / snapshot volají `HikConnectOpenApiProvider` — bez specifikace vrací srozumitelné `TODO` / chybu `HIKCONNECT_API_NOT_CONFIGURED`

## Co doplnit po obdržení dokumentace od Hikvision

1. `HIKCONNECT_OPENAPI_BASE_URL` — produkční base URL
2. Algoritmus podpisu v `sign-request.ts` (TODO)
3. Endpoint testu připojení v `HikConnectOpenApiProvider.testConnection`
4. Endpoint seznamu zařízení v `listDevices`
5. Endpoint kanálů/kamer v `listCameras`
6. Mechanismus live view (URL / token / SDK) v `getLiveView`
7. Vyhledávání záznamů v `searchRecordings`
8. Webhook ověření podpisu v `src/app/api/webhooks/hikvision/route.ts`

**Nepoužívejte** veřejnou IP z Device Management, RTSP port ani Digest ISAPI jako náhradu OpenAPI.
