import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { loadPlatformAiBranding } from "@/lib/platform-ai-branding";

export const dynamic = "force-dynamic";

/** Veřejné branding metadata (bez secret) — pro přihlášené i nepřihlášené UI. */
export async function GET() {
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ ok: true, branding: null });
  }
  const branding = await loadPlatformAiBranding(db);
  return NextResponse.json(
    { ok: true, branding },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
