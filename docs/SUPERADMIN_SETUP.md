# Global Superadmin – nastavení a použití

## 1. Vstup do globální administrace

- Na **přihlašovací stránce** portálu (`/login`) je odkaz **„Globální administrace“**.
- Kliknutím přejdete na `/admin/login`, kde se přihlásíte **uživatelským jménem a heslem** (ne Firebase emailem).

Globální administrace používá **oddělené přihlášení** od firemního portálu (cookie + JWT).

---

## 2. Výchozí superadmin účet (admin / admin123)

Pro rychlý start je k dispozici **výchozí účet**:

- **Uživatelské jméno:** `admin`
- **Heslo:** `admin123`

Heslo je ukládáno pouze jako **bcrypt hash** (nikdy v nezašifrované podobě).

### Vytvoření výchozího účtu (doporučeno)

1. V `.env.local` nastavte Firebase Admin (viz sekce 3 níže): `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
2. V kořenu projektu spusťte:
   ```bash
   npm run seed-superadmin
   ```
3. Skript vytvoří kolekci **`superadmins`** (pokud neexistuje) a přidá dokument s účtem `admin` a bcrypt hashem hesla `admin123`.
4. Přihlaste se na `/admin/login` pomocí **admin** / **admin123**.

Pokud účet `admin` již v kolekci existuje, skript nic nepřepíše.

### Kde jsou přihlašovací údaje uloženy a jak je změnit

- **Firestore (po spuštění `npm run seed-superadmin`):**  
  Kolekce **`superadmins`**. Každý superadmin je jeden dokument s poli: `username`, `passwordHash`, `role`, `active`, `createdAt`. Heslo je vždy pouze v poli `passwordHash` (bcrypt).

- **Změna hesla (Firestore):**  
  1. Vygenerujte nový bcrypt hash, např.:  
     `node -e "console.log(require('bcryptjs').hashSync('NoveHeslo', 10))"`  
  2. Ve Firebase Console → Firestore → kolekce **superadmins** → dokument s `username: "admin"` → pole **passwordHash** nahraďte vygenerovaným hashem.

- **Přihlášení přes env (bez Firestore):**  
  Pokud nechcete používat Firestore pro superadmin přihlášení, nastavte v `.env.local`:  
  `SUPERADMIN_USERNAME=admin` a `SUPERADMIN_PASSWORD_HASH=<bcrypt hash>`.  
  Hash získáte buď výstupem skriptu `npm run seed-superadmin` (vytiskne ho), nebo příkazem výše. V takovém případě se přihlášení ověřuje pouze z env a údaje v Firestore se nepoužívají.

**Důrazně doporučujeme** v produkci heslo `admin123` změnit (viz změna hesla výše).

### Přihlášení bez konfigurace (pouze vývoj)

V režimu **development** (`npm run dev`) platí výchozí účet **admin** / **admin123** i bez nastavení Firebase nebo env. Stačí otevřít `/admin/login` a přihlásit se. V produkci tento fallback neplatí – musíte použít Firestore (skript) nebo env.

---

## 3. Vytvoření dalších superadmin účtů

### Možnost A: Proměnné prostředí (pouze jeden účet)

1. Vygenerujte hash hesla (např. v Node.js):
   ```bash
   node -e "const b=require('bcryptjs'); console.log(b.hashSync('VaseSilneHeslo', 10))"
   ```
2. Do `.env.local` přidejte:
   ```env
   SUPERADMIN_USERNAME=superadmin
   SUPERADMIN_PASSWORD_HASH=<výstup z příkazu výše>
   SUPERADMIN_JWT_SECRET=<náhodný dlouhý řetězec pro podpis JWT>
   ```
3. Po uložení se na `/admin/login` přihlaste pomocí `superadmin` a zvoleného hesla.

### Možnost B: Seed API (více účtů, když máte Firebase Admin)

1. V `.env.local` nastavte **jednorázové** heslo pro seed:
   ```env
   INIT_SUPERADMIN_SECRET=VaseTajneHesloProSeed
   ```
2. Zavolejte API (např. z Postmanu nebo curl):
   ```bash
   curl -X POST http://localhost:9002/api/superadmin/seed \
     -H "Content-Type: application/json" \
     -d '{"secret":"VaseTajneHesloProSeed","username":"superadmin","password":"VaseSilneHeslo"}'
   ```
3. Účet se vytvoří v kolekci Firestore `superadmins` (vyžaduje nakonfigurovaný Firebase Admin – viz níže).
4. Po vytvoření účtu se přihlaste na `/admin/login` pomocí zadaného `username` a `password`.

### Kolekce Firestore `superadmins`

- **Cesta:** `superadmins` (kořenová kolekce v projektu)
- **Pole dokumentu:** `username`, `passwordHash`, `role` (např. `"superadmin"`), `active` (boolean), `createdAt` (timestamp).

Heslo se ukládá pouze jako bcrypt hash, nikdy v plain textu.

---

## 4. Firebase Admin (pro správu organizací a seed)

Pro načtení organizací a úpravu licencí z globálního adminu musí běžet Firebase Admin SDK v API routech.

1. V Firebase Console → Project Settings → Service accounts vygenerujte soukromý klíč a stáhněte JSON.
2. Z JSONu použijte:
   - `project_id` → `FIREBASE_PROJECT_ID` nebo ponechte `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY` (včetně `\n` jako uvnitř řetězce)
3. Do `.env.local` doplňte:
   ```env
   FIREBASE_CLIENT_EMAIL=...
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   ```

Bez těchto proměnných budou API volání pro **seznam organizací** vracet **503** a globální admin nebude moci načíst ani upravovat organizace. V takovém případě dashboard a stránka Organizace zobrazí upozornění s návodem doplnit `FIREBASE_CLIENT_EMAIL` a `FIREBASE_PRIVATE_KEY` do `.env.local`. Podrobnosti o struktuře organizací a licencí viz **docs/ADMIN_ORGANIZATIONS.md**.

---

## 5. Licence a moduly

V globálním adminu (**Organizace**) lze u každé organizace nastavit:

- **Typ licence:** Starter, Professional, Enterprise  
- **Stav licence:** Aktivní, Expirovaná, Pozastavená  
- **Max. počet uživatelů** (volitelně)  
- **Povolené moduly:** zapnutí/vypnutí (Zakázky, Docházka, Faktury, Finance, Doklady, Reporty, Mobilní terminál, Předplatné).

Data se ukládají do dokumentu organizace v poli `license`:

- `license.licenseType`
- `license.status`
- `license.expirationDate`
- `license.maxUsers`
- `license.enabledModules` (pole klíčů modulů)

V portálu lze později podle `license.enabledModules` skrývat nebo blokovat přístup k jednotlivým sekcím (implementace závisí na vašich routech a komponentách).

---

## 6. Zabezpečení

- **Hesla:** ukládána pouze jako bcrypt hash (env nebo Firestore).
- **Session:** po přihlášení se nastaví httpOnly cookie s JWT (platnost 24 h).
- **Middleware:** všechny cesty pod `/admin` kromě `/admin/login` vyžadují platnou superadmin session; jinak přesměrování na `/admin/login`.
- **API:** `/api/superadmin/*` kontrolují session z cookie; bez platné session vrací 401.

Doporučení: v produkci nastavte silný `SUPERADMIN_JWT_SECRET` a bezpečné heslo pro superadmin.
