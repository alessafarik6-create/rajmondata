import { NextRequest, NextResponse } from "next/server";
import { requireMeetingAudioAccess } from "@/lib/meeting-audio/meeting-audio-api-auth";
import { finalizeMeetingAudioRecording } from "@/lib/meeting-audio/meeting-audio-storage";
import { logMeetingAudioAudit } from "@/lib/meeting-audio/meeting-audio-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ recordId: string }> }
) {
  const { recordId } = await ctx.params;
  let body: { companyId?: string; uploadSessionId?: string; durationSeconds?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? "").trim();
  const uploadSessionId = String(body.uploadSessionId ?? "").trim();
  if (!companyId || !recordId || !uploadSessionId) {
    return NextResponse.json({ ok: false, error: "Chybí parametry." }, { status: 400 });
  }
  const auth = await requireMeetingAudioAccess(request, companyId);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  try {
    const { storagePath } = await finalizeMeetingAudioRecording(auth.db, {
      companyId,
      recordId,
      uploadSessionId,
      durationSeconds: Number(body.durationSeconds ?? 0),
    });
    await logMeetingAudioAudit(auth.db, {
      companyId,
      userId: auth.caller.uid,
      recordId,
      action: "meeting_recording_uploaded",
      detail: storagePath,
    });
    return NextResponse.json({ ok: true, storagePath });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Dokončení nahrávky selhalo.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
