import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getPlatformAiBranding } from "@/lib/platform-ai-branding";

export const dynamic = "force-dynamic";

/** Globální branding AI (read pro všechny organizace). */
export async function GET() {
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ ok: true, branding: null });
  }
  const branding = await getPlatformAiBranding(db);
  const { avatarStoragePath: _omit, ...publicBranding } = branding;
  return NextResponse.json(
    { ok: true, branding: publicBranding },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    }
  );
}
