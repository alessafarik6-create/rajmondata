import { NextRequest, NextResponse } from "next/server";
import { requireMeetingAudioAccess } from "@/lib/meeting-audio/meeting-audio-api-auth";
import { startMeetingAudioSession } from "@/lib/meeting-audio/meeting-audio-storage";
import { logMeetingAudioAudit } from "@/lib/meeting-audio/meeting-audio-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ recordId: string }> }
) {
  const { recordId } = await ctx.params;
  let body: { companyId?: string; userDisplayName?: string };
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

  const userSnap = await auth.db.collection("users").doc(auth.caller.uid).get();
  const displayName =
    String(body.userDisplayName ?? (userSnap.data() as { displayName?: string })?.displayName ?? "")
      .trim() || "Uživatel";

  const { uploadSessionId } = await startMeetingAudioSession(auth.db, {
    companyId,
    recordId,
    userId: auth.caller.uid,
    userName: displayName,
  });
  await logMeetingAudioAudit(auth.db, {
    companyId,
    userId: auth.caller.uid,
    recordId,
    action: "meeting_audio_started",
  });
  return NextResponse.json({ ok: true, uploadSessionId });
}
