/**
 * Jednorázová registrace public OAuth klienta RAJMONDATA u SatelitníSledování.cz.
 * Výstup: client_id → uložte do SATELITNI_SLEDOVANI_CLIENT_ID na Vercelu.
 *
 * node scripts/register-satelitni-oauth-client.mjs
 */
const redirectUri =
  process.env.SATELITNI_SLEDOVANI_REDIRECT_URI ||
  "https://rajmondata.cz/api/integrations/satelitni-sledovani/callback";

const res = await fetch("https://app.satelitnisledovani.cz/oauth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({
    client_name: "RAJMONDATA",
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  }),
});

const text = await res.text();
console.log("HTTP", res.status);
console.log(text);
if (!res.ok) process.exit(1);
