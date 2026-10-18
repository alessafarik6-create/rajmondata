# RAJMONDATA portál ↔ RAJMONDATA EDITOR (Railway)

Tento dokument popisuje integrační kontrakt mezi hlavním portálem (`rajmondata.cz`) a externím editorem (`rajmondata-editor-production.up.railway.app`).

## Identifikace modulu

| Pole | Hodnota |
|------|---------|
| Kód v licenci portálu | `rajmondata_editor` |
| Externí ID | `rajmondata-editor` |
| Typ | External SaaS |

## 1. Vytvoření launch ticketu (portál → editor)

**Request**

```http
POST {EDITOR_API_URL}/api/integrations/rajmondata-portal/v1/launch-tickets
Authorization: Bearer {RAJMONDATA_EDITOR_INTEGRATION_SECRET}
Content-Type: application/json
```

**Body**

```json
{
  "organizationId": "string",
  "organizationName": "string",
  "userId": "firebase-uid",
  "email": "user@example.com",
  "displayName": "Jan Novák",
  "moduleCode": "rajmondata_editor",
  "locale": "cs-CZ"
}
```

**Response `200`**

```json
{
  "ticket": "one-time-token",
  "expiresAt": "2026-03-29T12:00:00.000Z",
  "consumeUrl": "https://rajmondata-editor-production.up.railway.app/auth/portal/launch?ticket=..."
}
```

Portál přesměruje prohlížeč na `consumeUrl`. **Firebase ID token se nesmí předávat v URL.**

## 2. Výměna ticketu (editor → portál), záložní režim

Pokud editor volí ověření ticketu vystaveného portálem:

```http
POST https://www.rajmondata.cz/api/integrations/rajmondata-editor/v1/exchange-launch-ticket
Authorization: Bearer {RAJMONDATA_EDITOR_INTEGRATION_SECRET}
Content-Type: application/json
```

**Body**

```json
{ "ticketId": "uuid" }
```

**Response `200`**

```json
{
  "organizationId": "string",
  "organizationName": "string",
  "userId": "string",
  "email": "string",
  "displayName": "string",
  "moduleCode": "rajmondata_editor",
  "licenseActive": true
}
```

Ticket je jednorázový, platnost max. 5 minut, uložen v `platform_module_launch_tickets`.

## 3. Revokace přístupu (portál → editor)

```http
POST {EDITOR_API_URL}/api/integrations/rajmondata-portal/v1/revoke-access
Authorization: Bearer {RAJMONDATA_EDITOR_INTEGRATION_SECRET}
Content-Type: application/json
```

```json
{
  "organizationId": "string",
  "userId": "string | null",
  "reason": "license_suspended"
}
```

## Environment variables (portál / Vercel)

| Proměnná | Popis |
|----------|--------|
| `RAJMONDATA_EDITOR_APP_URL` | Veřejná URL editoru (redirect) |
| `RAJMONDATA_EDITOR_API_URL` | Base URL Railway API |
| `RAJMONDATA_EDITOR_INTEGRATION_SECRET` | Sdílené tajemství (server only) |
| `RAJMONDATA_EDITOR_LAUNCH_TICKETS_PATH` | Volitelně, default viz výše |

## Stav ověření

Integrace je **propojená** až když editor implementuje endpointy (1) a (3) a sdílené tajemství je nastavené na obou stranách. Do té doby portál zobrazí stav integrace „neověřeno“ a spuštění editoru skončí srozumitelnou chybou (bez falešného SSO).
