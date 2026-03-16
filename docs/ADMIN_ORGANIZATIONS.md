# Global Admin – Organizace a licence

## Firestore kolekce

- **Organizace:** kolekce **`společnosti`** (kořenová). Jedna organizace = jeden dokument; ID dokumentu = `companyId`. Globální admin čte a zapisuje pouze do této kolekce.
- **Superadmin účty:** kolekce **`superadmins`** (pouze pro přihlášení do globálního adminu).

---

## Struktura dokumentu organizace (`společnosti/{companyId}`)

Pole, která čte a zapisuje globální admin:

| Pole | Typ | Popis |
|------|-----|--------|
| `name` | string | Název organizace |
| `email` | string | Kontaktní e-mail |
| `ico` | string | IČO |
| `address` | string | Adresa |
| `ownerUserId` | string | UID vlastníka (Firebase Auth) |
| `isActive` | boolean | Stav účtu: aktivní / pozastavený |
| `licenseId` | string | Typ licence (starter, professional, enterprise) |
| `license` | object | Licence (viz níže) |
| `enabledModuleIds` | string[] | Povolené moduly (legacy z registrace; zapisujeme i při úpravě licence) |
| `createdAt` | timestamp | Datum vytvoření |
| `updatedAt` | timestamp | Datum poslední aktualizace |

**Objekt `license`** (ukládá se celý při PATCH):

- `licenseType`: "starter" | "professional" | "enterprise"
- `status`: "active" | "expired" | "suspended"
- `expirationDate`: string (ISO date) nebo null
- `maxUsers`: number nebo null
- `enabledModules`: string[] – klíče modulů (jobs, attendance, invoices, …)

---

## Načítání organizací

1. **API:** `GET /api/superadmin/companies`  
   - Kontrola: pouze přihlášený superadmin (session cookie).  
   - Volá se služba `getCompanies(db)` z `src/lib/superadmin-companies.ts`.  
   - Firestore: `db.collection("společnosti").get()` – **bez** `orderBy`, aby nebyl potřeba index.  
   - Seřazení podle `name` probíhá v paměti.  
   - Každý dokument se normalizuje pomocí `normalizeCompanyFromFirestore(data, id)`.

2. **Normalizace:**  
   - Pokud existuje `data.license`, použijí se z něj `licenseType`, `status`, `expirationDate`, `maxUsers`, `enabledModules`.  
   - Pokud ne, použije se `data.licenseId` a `data.enabledModuleIds` (registrace).  
   - Neznámé klíče v `enabledModules` / `enabledModuleIds` se odfiltrují na podporované moduly (viz `MODULE_KEYS` v `src/lib/license-modules.ts`).  
   - Chybějící pole se doplní výchozími hodnotami (např. `DEFAULT_LICENSE`).

3. **Odpověď:** JSON pole objektů s: `id`, `name`, `email`, `ico`, `address`, `ownerUserId`, `isActive`, `createdAt`, `updatedAt`, `licenseId`, `license` (včetně `licenseExpiresAt` = alias pro `expirationDate`).

---

## Ukládání licence a modulů

1. **API:** `PATCH /api/superadmin/companies/[id]`  
   - Tělo: `{ isActive?: boolean, license?: { licenseType?, status?, expirationDate?, licenseExpiresAt?, maxUsers?, enabledModules? } }`.  
   - Kontrola: pouze přihlášený superadmin.

2. **Zápis do Firestore:**  
   - Služba `updateCompany(db, id, payload)` v `src/lib/superadmin-companies.ts`.  
   - Z `payload.license` sestaví objekt `license` (licenseType, status, expirationDate, maxUsers, enabledModules) a zapíše:  
     - `updates.license`  
     - `updates.licenseId` = licenseType  
     - `updates.enabledModuleIds` = enabledModules (kvůli zpětné kompatibilitě)  
     - `updates.updatedAt` = now  
   - Volitelně `updates.isActive` při aktivaci/pozastavení.  
   - Použije se `doc.update(updates)`.

3. **Moduly:**  
   - Povolené klíče: `jobs`, `attendance`, `invoices`, `finance`, `documents`, `reports`, `mobile_terminal`, `subscriptions` (`AVAILABLE_MODULES` / `MODULE_KEYS` v `src/lib/license-modules.ts`).  
   - Při ukládání se neplatné klíče z `enabledModules` odfiltrují.

---

## Registrace a vytvoření organizace

Při **registraci nové firmy** (`src/app/register/page.tsx`) se automaticky:

1. Vytvoří uživatel ve **Firebase Auth** a nastaví se `displayName`.
2. Vygeneruje se `companyId` (slug z názvu + náhodný suffix).
3. Zapíše se **batch** do Firestore:
   - **`společnosti/{companyId}`** – dokument organizace (superadmin dashboard)
   - **`companies/{companyId}`** – stejný dokument (portál a subkolekce: employees, jobs, …)
   - **`users/{uid}`** – profil uživatele s `companyId`, `role: "owner"`
   - **`users/{uid}/company_roles/{companyId}`** – role `owner`
   - **`companies/{companyId}/employees/{uid}`** – první zaměstnanec (majitel)

**Struktura dokumentu organizace vytvořeného při registraci:**

| Pole | Hodnota |
|------|--------|
| `id`, `name`, `slug`, `email`, `ico`, `phone`, `address` | Z formuláře |
| `ownerUserId`, `createdBy` | UID vlastníka |
| `active`, `isActive` | true |
| `plan`, `licenseId` | "starter" |
| `licenseStatus` | "active" |
| `license` | `{ licenseType, status, expirationDate: null, maxUsers: 10, enabledModules: ["jobs", "attendance", "invoices", "documents"] }` |
| `enabledModuleIds` | Stejné jako `license.enabledModules` |
| `createdAt`, `updatedAt` | serverTimestamp() |

**Profil uživatele po registraci:** `id`, `email`, `displayName`, `companyId`, `role: "owner"`, `globalRoles: []`, `createdAt`.

Kolekce jsou definované v **`src/lib/firestore-collections.ts`**: `ORGANIZATIONS_COLLECTION = "společnosti"`, `COMPANIES_COLLECTION = "companies"`, `USERS_COLLECTION = "users"`.

---

## Výchozí struktura u nových organizací

- Při **registraci** se vytvoří dokument s plným objektem `license` a `enabledModuleIds` (viz výše). Stejný dokument se zapisuje do **společnosti** i **companies**.
- **Globální admin** při čtení normalizuje dokumenty z `společnosti`; `licenseId` a `enabledModuleIds` se používají, pokud chybí vnořený `license`.
- Při **úpravě licence** ze superadmin rozhraní se aktualizuje dokument v `společnosti` (a volitelně lze v budoucnu synchronizovat do `companies`).

---

## Přístupová kontrola

- Všechny route handlery pod `src/app/api/superadmin/*` na začátku volají `getSessionFromCookie()`. Bez platné session vrací **401**.  
- Middleware chrání `/admin/*` (kromě `/admin/login`) – neplatná session přesměruje na `/admin/login`.  
- Čtení a zápis organizací a licencí tedy může pouze superadmin s platnou session.

---

## Změněné a nové soubory (souhrn)

| Soubor | Účel |
|--------|------|
| `src/lib/superadmin-companies.ts` | Služba: `getCompanies`, `getCompany`, `updateCompany`, `normalizeCompanyFromFirestore`. Kolekce **`společnosti`**. |
| `src/lib/license-modules.ts` | Přidán export `MODULE_KEYS` pro validaci modulů. |
| `src/app/api/superadmin/companies/route.ts` | GET používá `getCompanies(db)`, vrací normalizovaný seznam. Lepší hláška při 503. |
| `src/app/api/superadmin/companies/[id]/route.ts` | GET používá `getCompany`, PATCH používá `updateCompany`. Přijímá i `licenseExpiresAt`. |
| `src/app/admin/companies/page.tsx` | Načítání: zobrazení chyby při 503, prázdný stav. Tabulka: ID, Vytvořeno. Dialog licence: datum expirace, max uživatelé, přepínače modulů. Ukládání volá PATCH s `license` a `isActive`. |
| `src/app/admin/dashboard/page.tsx` | Načítání organizací z API, zobrazení chyby při selhání. |
| `src/app/admin/licenses/page.tsx` | Načítání z API, zobrazení chyby při selhání. |
| `docs/ADMIN_ORGANIZATIONS.md` | Tato dokumentace. |
