import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { assertCallerCanMeetingRecordsStaffActions } from "@/lib/meeting-records-api-auth";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { ORGANIZATION_CALENDAR_MEETINGS_COLLECTION } from "@/lib/calendar/organization-calendar-repository";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Neplatné přihlášení." }, { status: 401 });
  }

  let body: { companyId?: string; calendarEventId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? caller.companyId).trim();
  const calendarEventId = String(body.calendarEventId ?? "").trim();
  if (!companyId || !calendarEventId) {
    return NextResponse.json({ ok: false, error: "Chybí parametry." }, { status: 400 });
  }
  const gate = await assertCallerCanMeetingRecordsStaffActions(db, caller, companyId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const existing = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("meetingRecords")
    .where("calendarEventId", "==", calendarEventId)
    .limit(1)
    .get();
  if (!existing.empty) {
    return NextResponse.json({ ok: true, recordId: existing.docs[0].id, created: false });
  }

  const evSnap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(ORGANIZATION_CALENDAR_MEETINGS_COLLECTION)
    .doc(calendarEventId)
    .get();
  if (!evSnap.exists) {
    return NextResponse.json({ ok: false, error: "Událost kalendáře neexistuje." }, { status: 404 });
  }
  const ev = evSnap.data() as Record<string, unknown>;
  const userSnap = await db.collection("users").doc(caller.uid).get();
  const displayName = String((userSnap.data() as { displayName?: string })?.displayName ?? "").trim();

  const title = String(ev.title ?? ev.customerName ?? "Schůzka").trim();
  const scheduledAt = (ev.scheduledAt as Timestamp | undefined)?.toDate?.() ?? new Date();

  const ref = await db.collection(COMPANIES_COLLECTION).doc(companyId).collection("meetingRecords").add({
    companyId,
    title,
    meetingTitle: title,
    meetingAt: Timestamp.fromDate(scheduledAt),
    place: String(ev.place ?? "").trim() || null,
    participants: null,
    jobId: typeof ev.jobId === "string" ? ev.jobId : null,
    jobName: typeof ev.jobName === "string" ? ev.jobName : null,
    customerId: typeof ev.customerId === "string" ? ev.customerId : null,
    customerName: String(ev.customerName ?? "").trim() || null,
    calendarEventId,
    calendarEventKind: String(ev.calendarEventType ?? "meeting"),
    meetingNotes: String(ev.note ?? "").trim() || "",
    sharedWithCustomer: false,
    visibility: "internal",
    createdBy: caller.uid,
    createdByName: displayName || null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, recordId: ref.id, created: true });
}
