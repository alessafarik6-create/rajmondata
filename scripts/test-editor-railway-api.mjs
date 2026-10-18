/**
 * Ověří dostupnost Railway API editoru (bez produkčního SSO — vyžaduje PORTAL_API_SECRET na obou stranách).
 * Usage: node scripts/test-editor-railway-api.mjs
 */
const base =
  process.env.RAJMONDATA_EDITOR_API_URL?.trim() ||
  "https://rajmondata-editor-production.up.railway.app";

const healthRes = await fetch(`${base}/api/v1/health`);
const health = await healthRes.json();
console.log("GET /api/v1/health", healthRes.status, health);

const fakeJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1aWQiOiJ0ZXN0In0.";
const launchBody = JSON.stringify({
  idToken: fakeJwt,
  organizationId: "test-org",
  moduleActive: true,
  licenseActive: true,
  userId: "test",
  email: "test@example.com",
  displayName: "Test",
});
const launchRes = await fetch(`${base}/api/v1/launch-tickets`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: launchBody,
});
const launchJson = await launchRes.json();
console.log("POST /api/v1/launch-tickets (unsigned)", launchRes.status, launchJson);

const logoutRes = await fetch(`${base}/api/v1/logout`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ idToken: fakeJwt, organizationId: "test-org" }),
});
console.log("POST /api/v1/logout", logoutRes.status, await logoutRes.text());
