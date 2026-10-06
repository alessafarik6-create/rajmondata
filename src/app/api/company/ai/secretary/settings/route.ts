import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import {
  AI_SECRETARY_SETTINGS_DOC_ID,
  defaultAiSecretarySettings,
  loadAiSecretarySettings,
  type AiSecretarySettingsDoc,
} from "@/lib/ai/secretary/settings";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export const dynamic = "force-dynamic";

function canManageSettings(role: string): boolean {
  return role === "owner" || role === "admin" || role === "manager";
}

export async function GET(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ ok: false, error: "Server error." }, { status: 503 });
  }
  const token = String(request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const caller = await verifyBearerAndLoadCaller(auth, db, token);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || caller.companyId;
  if (companyId !== caller.companyId) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const settings = await loadAiSecretarySettings(db, companyId);
  return NextResponse.json({ ok: true, settings });
}

export async function PATCH(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ ok: false, error: "Server error." }, { status: 503 });
  }
  const token = String(request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const caller = await verifyBearerAndLoadCaller(auth, db, token);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageSettings(caller.role)) {
    return NextResponse.json({ ok: false, error: "Nemáte oprávnění měnit nastavení." }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    companyId?: string;
    settings?: Partial<AiSecretarySettingsDoc>;
  };
  const companyId = String(body.companyId ?? caller.companyId).trim();
  if (companyId !== caller.companyId) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const current = await loadAiSecretarySettings(db, companyId);
  const patch = body.settings ?? {};
  const next: AiSecretarySettingsDoc = {
    ...current,
    ...patch,
    modules: {
      ...current.modules,
      ...(patch.modules ?? {}),
    },
  };
  await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("ai_secretary_settings")
    .doc(AI_SECRETARY_SETTINGS_DOC_ID)
    .set(
      {
        ...next,
        updatedByUserId: caller.uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  return NextResponse.json({ ok: true, settings: next });
}

export async function PUT(request: NextRequest) {
  return PATCH(request);
}
