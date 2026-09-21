import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  loadPlatformAiBranding,
  savePlatformAiBranding,
  DEFAULT_PLATFORM_AI_BRANDING,
} from "@/lib/platform-ai-branding";
import { PLATFORM_SECURITY_AUDIT_COLLECTION } from "@/lib/firestore-collections";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  const branding = await loadPlatformAiBranding(db);
  return NextResponse.json({ ok: true, branding, defaults: DEFAULT_PLATFORM_AI_BRANDING });
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

  const body = (await request.json()) as {
    assistantName?: string;
    assistantSubtitle?: string;
    resetAvatar?: boolean;
  };

  const patch: Parameters<typeof savePlatformAiBranding>[1] = {
    updatedBy: session.username,
  };
  if (typeof body.assistantName === "string") patch.assistantName = body.assistantName.trim();
  if (typeof body.assistantSubtitle === "string")
    patch.assistantSubtitle = body.assistantSubtitle.trim();
  if (body.resetAvatar) {
    patch.avatarUrl = null;
    patch.avatarStoragePath = null;
  }

  await savePlatformAiBranding(db, patch);

  await db.collection(PLATFORM_SECURITY_AUDIT_COLLECTION).add({
    actionType: "PLATFORM_AI_BRANDING_CHANGED",
    updatedBy: session.username,
    createdAt: new Date(),
  });

  return NextResponse.json({ ok: true });
}
