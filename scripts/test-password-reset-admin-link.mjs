import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const portalRoute = readFileSync(
  join(root, "src/app/api/company/customers/portal-password-reset/route.ts"),
  "utf8"
);
const linkLib = readFileSync(join(root, "src/lib/password-reset-link.ts"), "utf8");
const resetPage = readFileSync(join(root, "src/app/reset-password/page.tsx"), "utf8");

assert.match(portalRoute, /generateAppPasswordResetLink/, "admin API uses app link generator");
assert.match(portalRoute, /resolveAppBaseUrl/, "requires app base URL");
assert.match(linkLib, /PASSWORD_RESET_PAGE_PATH = "\/reset-password"/, "canonical path");
assert.match(linkLib, /passwordResetActionCodeSettings/, "action code settings");
assert.match(resetPage, /obnova-hesla/, "reset-password reuses portal page");

function toApp(firebaseLink, base) {
  const u = new URL(firebaseLink);
  const oobCode = u.searchParams.get("oobCode");
  const mode = u.searchParams.get("mode");
  if (!oobCode || (mode && mode !== "resetPassword")) return firebaseLink;
  const out = new URL(`${base}/reset-password`);
  out.searchParams.set("mode", "resetPassword");
  out.searchParams.set("oobCode", oobCode);
  return out.toString();
}

const firebase =
  "https://studio-xxxxx.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=ABC123&apiKey=k1&lang=cs";
const app = toApp(firebase, "https://rajmondata.cz");
assert.match(app, /^https:\/\/rajmondata\.cz\/reset-password/);
assert.match(app, /oobCode=ABC123/);
assert.equal(
  toApp("https://rajmondata.cz/reset-password?mode=resetPassword&oobCode=XYZ", "https://rajmondata.cz"),
  "https://rajmondata.cz/reset-password?mode=resetPassword&oobCode=XYZ"
);

console.log("OK: test-password-reset-admin-link");
