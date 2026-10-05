import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireMeetingAudioAccess } from "@/lib/meeting-audio/meeting-audio-api-auth";
import { meetingRecordsCollection } from "@/lib/meeting-audio/meeting-audio-storage";
import { generateCustomerFacingMeetingSummary } from "@/lib/meeting-audio/meeting-customer-summary";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ recordId: string }> }
) {
  const { recordId } = await ctx.params;
  let body: { companyId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? "").trim();
  if (!companyId || !recordId) {
    return NextResponse.json({ ok: false, error: "Chybí parametry." }, { status: 400 });
  }
  const auth = await requireMeetingAudioAccess(request, companyId);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const ref = meetingRecordsCollection(auth.db, companyId).doc(recordId);
  const snap = await ref.get();
  const data = snap.data() as {
    meetingNotes?: string;
    aiSummary?: { markdown?: string };
  };
  const internal = String(data.aiSummary?.markdown ?? data.meetingNotes ?? "").trim();
  if (!internal) {
    return NextResponse.json({ ok: false, error: "Chybí interní zápis." }, { status: 400 });
  }

  try {
    const customerFacingNotes = await generateCustomerFacingMeetingSummary(internal);
    await ref.set(
      {
        customerFacingNotes,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return NextResponse.json({ ok: true, customerFacingNotes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Generování selhalo.";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
