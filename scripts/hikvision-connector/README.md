# RAJMONDATA Local Connector (Hikvision)

Lokální služba v LAN zákazníka. Komunikuje s Hikvision NVR přes ISAPI/RTSP a s cloudem přes **odchozí HTTPS** (bez inbound portů do LAN).

## Registrace

1. V portálu: **Nastavení → Integrace → Hikvision → Token pro Local Connector**
2. Na serveru v LAN spusťte connector s proměnnými:

```bash
RAJMONDATA_API_URL=https://vase-instance.vercel.app
RAJMONDATA_COMPANY_ID=<firestore company id>
RAJMONDATA_REGISTRATION_TOKEN=<token z portálu>
```

3. Connector zavolá `PUT /api/company/hikvision/connector/heartbeat` s tělem registrace a uloží si `connectorId` + `connectorSecret`.

## Heartbeat

Každých 30 s:

```http
POST /api/company/hikvision/connector/heartbeat
Authorization: Connector <connectorId>:<sha256(connectorSecret)>
Content-Type: application/json

{ "companyId": "..." }
```

## Fáze 2+

Connector bude vykonávat ISAPI joby (test, sync, snapshot, alertStream) místo přímého volání z Vercelu.
