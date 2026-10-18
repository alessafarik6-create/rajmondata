# RAJMONDATA portál ↔ RAJMONDATA EDITOR (Railway)

Base URL: `https://rajmondata-editor-production.up.railway.app`

## Identifikace modulu

| Pole | Hodnota |
|------|---------|
| Kód licence portálu | `rajmondata_editor` |
| Modul v API editoru | `rajmondata-editor` |

## Autentizace server → server (HMAC)

Všechny požadavky portálu na API editoru (kromě `GET /api/v1/health`) musí mít:

1. Tělo requestu jako ** přesný JSON string** (stejná serializace pro podpis i pro `fetch`).
2. Hlavičky:
   - `X-Portal-Timestamp` — Unix čas v **milisekundách** (string)
   - `X-Portal-Nonce` — náhodný řetězec (min. 16 znaků)
   - `X-Portal-Signature` — `HMAC-SHA256(PORTAL_API_SECRET, body)` v **hex** (malá písmena)

`PORTAL_API_SECRET` je pouze na serveru portálu (Vercel) a shodně `PORTAL_API_SECRET` na Railway editoru.

## Endpointy

### GET `/api/v1/health`

Bez podpisu. Odpověď mimo jiné: `portalAuthConfigured`, `firebaseConfigured`.

### POST `/api/v1/launch-tickets`

Vytvoření jednorázového ticketu pro SSO.

**Tělo (JSON)**

```json
{
  "idToken": "<Firebase ID token přihlášeného uživatele>",
  "organizationId": "<Firestore ID organizace>",
  "organizationName": "Název firmy",
  "userId": "<Firebase uid>",
  "email": "user@example.com",
  "displayName": "Jan Novák",
  "moduleActive": true,
  "licenseActive": true
}
```

Portál ověří licenci **před** voláním. `moduleActive` / `licenseActive` musí odpovídat stavu v `company_licenses`.

**Odpověď `200`**

```json
{
  "ok": true,
  "ticket": "<one-time-token>",
  "expiresAt": "ISO-8601"
}
```

**Přesměrování prohlížeče:** `{APP_URL}/launch#ticket={ticket}`  
(Nepoužívat query parametr ani Firebase token v URL.)

### POST `/api/v1/modules/rajmondata-editor/access`

Synchronizace oprávnění (aktivace / deaktivace / sedadla).

**Tělo (JSON)**

```json
{
  "organizationId": "<id>",
  "moduleActive": true,
  "licenseActive": true,
  "users": [
    { "userId": "<firebase uid>", "active": true }
  ]
}
```

Při deaktivaci organizace: `moduleActive: false`, `licenseActive: false`, `users: []`.

### POST `/api/v1/logout`

Ukončení session v editoru (volitelně z portálu při odhlášení).

**Tělo (JSON)**

```json
{
  "idToken": "<Firebase ID token>",
  "organizationId": "<id>"
}
```

## Proměnné prostředí

| Portál (Vercel) | Editor (Railway) |
|-----------------|------------------|
| `PORTAL_API_SECRET` | `PORTAL_API_SECRET` (stejná hodnota) |
| `RAJMONDATA_EDITOR_APP_URL` | — |
| `RAJMONDATA_EDITOR_API_URL` | — |

Legacy alias na portálu: `RAJMONDATA_EDITOR_INTEGRATION_SECRET` (= `PORTAL_API_SECRET`).

## Chybové kódy (editor)

| Kód | Význam |
|-----|--------|
| `PORTAL_AUTH_NOT_CONFIGURED` | Na Railway chybí `PORTAL_API_SECRET` |
| `BAD_INPUT` | Neplatné tělo / chybí povinná pole |
| `UNAUTHORIZED` | Neplatný HMAC nebo token |

## Ověření propojení

Integrace je produkčně ověřená až když:

1. `GET /api/v1/health` → `portalAuthConfigured: true`
2. S platným `PORTAL_API_SECRET` vrátí `POST /api/v1/launch-tickets` ticket (ne `503`)
