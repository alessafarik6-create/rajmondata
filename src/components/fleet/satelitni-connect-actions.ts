/** Sdílené volání OAuth connect (GET + Bearer). */
export async function startSatelitniOAuthConnect(
  companyId: string,
  idToken: string
): Promise<{ ok: true; authorizeUrl: string } | { ok: false; error: string }> {
  const res = await fetch(
    `/api/integrations/satelitni-sledovani/connect?companyId=${encodeURIComponent(companyId)}`,
    { headers: { Authorization: `Bearer ${idToken}` } }
  );
  const data = (await res.json()) as { ok?: boolean; authorizeUrl?: string; error?: string };
  if (!data.ok || !data.authorizeUrl) {
    return { ok: false, error: data.error ?? "Nepodařilo se zahájit připojení." };
  }
  return { ok: true, authorizeUrl: String(data.authorizeUrl) };
}
