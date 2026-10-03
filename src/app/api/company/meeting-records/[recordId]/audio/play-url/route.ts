import { NextRequest, NextResponse } from "next/server";
import { requireMeetingAudioAccess } from "@/lib/meeting-audio/meeting-audio-api-auth";
import { getMeetingAudioSignedUrl, meetingRecordsCollection } from "@/lib/meeting-audio/meeting-audio-storage";
import type { MeetingAudioMeta } from "@/lib/meeting-records-media-types";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ recordId: string }> }
) {
  const { recordId } = await ctx.params;
  const companyId = String(request.nextUrl.searchParams.get("companyId") ?? "").trim();
  if (!companyId || !recordId) {
    return NextResponse.json({ ok: false, error: "Chybí parametry." }, { status: 400 });
  }
  const auth = await requireMeetingAudioAccess(request, companyId);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const snap = await meetingRecordsCollection(auth.db, companyId).doc(recordId).get();
  const audio = (snap.data()?.audio ?? {}) as MeetingAudioMeta;
  if (!audio.storagePath) {
    return NextResponse.json({ ok: false, error: "Audio není k dispozici." }, { status: 404 });
  }
  const url = await getMeetingAudioSignedUrl(audio.storagePath);
  return NextResponse.json({ ok: true, url });
}
