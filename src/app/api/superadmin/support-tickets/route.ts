import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { SUPPORT_TICKETS_COLLECTION } from "@/lib/firestore-collections";

function tsToIso(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object" && v !== null && typeof (v as { toDate?: () => Date }).toDate === "function") {
    try {
      return (v as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (typeof v === "object" && v !== null) {
    const s = Number((v as { seconds?: number }).seconds ?? (v as { _seconds?: number })._seconds);
    if (Number.isFinite(s)) return new Date(s * 1000).toISOString();
  }
  return null;
}

function serializeTicket(id: string, data: Record<string, unknown>) {
  return {
    id,
    organizationId: data.organizationId,
    organizationName: data.organizationName,
    type: data.type,
    subject: data.subject,
    status: data.status,
    lastMessageText: data.lastMessageText ?? null,
    lastMessageRole: data.lastMessageRole ?? null,
    createdAt: tsToIso(data.createdAt) ?? null,
    updatedAt: tsToIso(data.updatedAt) ?? null,
    lastMessageAt: tsToIso(data.lastMessageAt) ?? null,
  };
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "superadmin") {
    return NextResponse.json({ error: "Přístup jen pro superadministrátora." }, { status: 403 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  const statusFilter = String(request.nextUrl.searchParams.get("status") || "").trim();
  const typeFilter = String(request.nextUrl.searchParams.get("type") || "").trim();
  try {
    let snap = await db
      .collection(SUPPORT_TICKETS_COLLECTION)
      .orderBy("updatedAt", "desc")
      .limit(200)
      .get();
    let rows = snap.docs.map((d) => serializeTicket(d.id, d.data() as Record<string, unknown>));
    if (statusFilter && ["open", "answered", "closed"].includes(statusFilter)) {
      rows = rows.filter((r) => String(r.status) === statusFilter);
    }
    if (typeFilter && ["dotaz", "napad", "feature"].includes(typeFilter)) {
      rows = rows.filter((r) => String(r.type) === typeFilter);
    }
    return NextResponse.json({ tickets: rows });
  } catch (e) {
    console.error("[superadmin support-tickets GET]", e);
    const msg = e instanceof Error ? e.message : "Chyba načtení.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
