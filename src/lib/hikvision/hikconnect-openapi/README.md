# Hik-Connect for Teams / HikCentral Connect OpenAPI

Implementace v RAJMONDATA vychází z **HikCentral Connect OpenAPI Developer Guide** (Hik-Connect for Teams):

- Autentizace: `POST /api/hccgw/platform/v1/token/get` — JSON `{ appKey, secretKey }` → `accessToken`
- Další volání: HTTP header **`Token: {accessToken}`** (ne ISAPI Digest, ne HCP Artemis X-Ca-Signature)
- Test: token + `GET /api/hccgw/platform/v1/systemproperties`
- Zařízení: `POST /api/hccgw/resource/v1/devices/get`
- Kamery: `POST /api/hccgw/resource/v1/areas/cameras/get`
- Stream token (live): `GET /api/hccgw/platform/v1/streamtoken/get`
- Snapshot: `POST /api/hccgw/resource/v1/device/capturePic`

## Server env (Vercel)

| Proměnná | Povinné | Popis |
|----------|---------|--------|
| `EMAIL_CREDENTIALS_ENCRYPTION_KEY` | ano | Šifrování API Secret v DB |
| `HIKCONNECT_OPENAPI_BASE_URL` | ne | Přepíše region, např. `https://ieu.hikcentralconnect.com` |
| `HIKCONNECT_OPENAPI_REGION` | ne | `eu` (default), `us`, `sg`, `sa`, `ru` — hostname dle dokumentace |

API Key / Secret **organizace** — pouze v Firestore (`private/credentials`), ne v env.

## Klient

`client.ts` — token cache per organization, ukládá `areaDomain` z odpovědi token/get.
