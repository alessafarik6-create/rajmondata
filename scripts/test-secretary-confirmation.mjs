/** Minimální test confirmation engine (regex). */
const CONFIRM_RE =
  /\b(ano|jo|jasně|potvrzuji|udělej\s*to|udělej|platí|souhlasím|ok\b|okay)\b/i;

function confirms(text) {
  return CONFIRM_RE.test(String(text ?? "").trim());
}

const cases = [
  ["Ano.", true],
  ["Ne, dej to na deset.", false],
  ["Potvrzuji.", true],
  ["", false],
];

let failed = 0;
for (const [text, expected] of cases) {
  const got = confirms(text);
  if (got !== expected) {
    console.error("FAIL", text, got, expected);
    failed++;
  }
}
if (failed) process.exit(1);
console.log("OK secretary confirmation", cases.length);
