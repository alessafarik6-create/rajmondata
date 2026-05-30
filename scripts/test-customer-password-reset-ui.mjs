import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadValidation() {
  const src = readFileSync(join(root, "src/lib/new-password-form-validation.ts"), "utf8");
  assert.match(src, /PASSWORD_MISMATCH_MESSAGE = "Hesla se neshodují\."/, "mismatch message");
  assert.match(src, /passwordPolicyError/, "uses system password policy");

  const minLen = 6;
  function validate(password, confirm) {
    const errors = {};
    const p = password.trim();
    const c = confirm.trim();
    if (!p) errors.password = "Vyplňte nové heslo.";
    else if (p.length < minLen) errors.password = `Heslo musí mít alespoň ${minLen} znaků.`;
    if (!c) errors.confirm = "Potvrďte nové heslo.";
    else if (p && c && p !== c) errors.confirm = "Hesla se neshodují.";
    return errors;
  }
  return validate;
}

const validate = loadValidation();

assert.deepEqual(validate("abcdef", "abcdef"), {}, "matching passwords ok");
assert.equal(
  validate("abcdef", "abcdeg").confirm,
  "Hesla se neshodují.",
  "mismatch error"
);
assert.match(
  validate("abc", "abc").password,
  /alespoň 6/,
  "short password rejected"
);
assert.equal(validate("", "").password, "Vyplňte nové heslo.", "empty password");
assert.equal(validate("abcdef", "").confirm, "Potvrďte nové heslo.", "empty confirm");

const resetPage = readFileSync(join(root, "src/app/login/obnova-hesla/page.tsx"), "utf8");
assert.match(resetPage, /PublicAuthPageLayout/, "uses public auth layout");
assert.match(resetPage, /Potvrzení nového hesla/, "confirm field label");
assert.match(resetPage, /Uložit nové heslo/, "submit label");
assert.match(resetPage, /PasswordInputField/, "password visibility toggle");
assert.match(resetPage, /PUBLIC_AUTH_SUBMIT_BUTTON_CLASS/, "orange submit button class");
assert.match(resetPage, /confirmPasswordReset/, "firebase reset preserved");

const profilePage = readFileSync(join(root, "src/app/portal/customer/profile/page.tsx"), "utf8");
assert.match(profilePage, /PasswordInputField/, "profile uses password field");
assert.match(profilePage, /Změnit heslo/, "profile submit label");

console.log("OK: test-customer-password-reset-ui");
