import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminStorageBucket } from "@/lib/firebase-admin";
import { requireMeetingAudioAccess } from "@/lib/meeting-audio/meeting-audio-api-auth";
import { meetingRecordsCollection } from "@/lib/meeting-audio/meeting-audio-storage";
import { logMeetingAudioAudit } from "@/lib/meeting-audio/meeting-audio-audit";
import type { MeetingAudioMeta } from "@/lib/meeting-records-media-types";

export const dynamic = "force-dynamic";

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
  const audio = (snap.data()?.audio ?? {}) as MeetingAudioMeta;
  const bucket = getAdminStorageBucket();
  if (bucket && audio.storagePath) {
    await bucket.file(audio.storagePath).delete({ ignoreNotFound: true }).catch(() => undefined);
  }
  for (const p of audio.chunkPaths ?? []) {
    if (bucket && p) await bucket.file(p).delete({ ignoreNotFound: true }).catch(() => undefined);
  }

  await ref.set(
    {
      audio: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await logMeetingAudioAudit(auth.db, {
    companyId,
    userId: auth.caller.uid,
    recordId,
    action: "meeting_recording_deleted",
  });

  return NextResponse.json({ ok: true });
}
