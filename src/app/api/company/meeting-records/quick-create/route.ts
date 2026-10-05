import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { assertCallerCanMeetingRecordsStaffActions } from "@/lib/meeting-records-api-auth";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

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

  let body: {
    companyId?: string;
    meetingTitle?: string;
    participants?: string;
    jobId?: string;
    jobName?: string;
    customerId?: string;
    customerName?: string;
    meetingAtIso?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? caller.companyId).trim();
  if (companyId !== caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const gate = await assertCallerCanMeetingRecordsStaffActions(db, caller, companyId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const title = String(body.meetingTitle ?? "").trim() || "Audio záznam schůzky";
  const meetingAt = body.meetingAtIso ? new Date(body.meetingAtIso) : new Date();
  const userSnap = await db.collection("users").doc(caller.uid).get();
  const displayName = String((userSnap.data() as { displayName?: string })?.displayName ?? "").trim();

  const jobId = String(body.jobId ?? "").trim() || null;
  const ref = await db.collection(COMPANIES_COLLECTION).doc(companyId).collection("meetingRecords").add({
    companyId,
    title,
    meetingTitle: title,
    meetingAt: Timestamp.fromDate(meetingAt),
    place: null,
    participants: String(body.participants ?? "").trim() || null,
    jobId,
    jobName: String(body.jobName ?? "").trim() || null,
    customerId: String(body.customerId ?? "").trim() || null,
    customerName: String(body.customerName ?? "").trim() || null,
    meetingNotes: "",
    nextSteps: null,
    sharedWithCustomer: false,
    sentToCustomer: false,
    isSharedWithCustomer: false,
    visibility: "internal",
    assignmentStatus: jobId ? "assigned" : "unassigned",
    createdBy: caller.uid,
    createdByName: displayName || null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    source: "audio_recording",
  });

  return NextResponse.json({ ok: true, recordId: ref.id });
}
