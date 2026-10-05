import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireMeetingAudioAccess } from "@/lib/meeting-audio/meeting-audio-api-auth";
import { meetingRecordsCollection } from "@/lib/meeting-audio/meeting-audio-storage";
import { transcribeMeetingAudioFromStorage } from "@/lib/meeting-audio/meeting-audio-transcribe";
import { generateMeetingAiSummaryFromTranscript } from "@/lib/meeting-audio/meeting-ai-summary";
import { logMeetingAudioAudit } from "@/lib/meeting-audio/meeting-audio-audit";
import type { MeetingAudioMeta, MeetingTranscriptMeta } from "@/lib/meeting-records-media-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Jedním voláním: přepis + AI zápis (pro UI „Zpracovat pomocí AI“). */
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
  if (audio.status !== "ready" || !audio.storagePath) {
    return NextResponse.json({ ok: false, error: "Audio záznam není připraven." }, { status: 400 });
  }

  await ref.set(
    {
      transcript: { status: "processing", createdAt: FieldValue.serverTimestamp() },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    const text = await transcribeMeetingAudioFromStorage(audio.storagePath);
    await ref.set(
      {
        transcript: {
          status: "ready",
          text,
          language: "cs",
          createdAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await logMeetingAudioAudit(auth.db, {
      companyId,
      userId: auth.caller.uid,
      recordId,
      action: "meeting_transcribed",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Přepis selhal.";
    await ref.set(
      {
        transcript: { status: "failed", errorMessage: msg, createdAt: FieldValue.serverTimestamp() },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return NextResponse.json({ ok: false, error: msg, stage: "transcribe" }, { status: 502 });
  }

  const snap2 = await ref.get();
  const transcript = (snap2.data()?.transcript ?? {}) as MeetingTranscriptMeta;
  if (!transcript.text?.trim()) {
    return NextResponse.json({ ok: false, error: "Prázdný přepis." }, { status: 400 });
  }

  await ref.set(
    {
      aiSummary: { status: "processing", createdAt: FieldValue.serverTimestamp() },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    const result = await generateMeetingAiSummaryFromTranscript(transcript.text);
    const nextSteps = result.structured.nextSteps.join("\n");
    await ref.set(
      {
        aiSummary: {
          status: "ready",
          structured: result.structured,
          markdown: result.markdown,
          suggestedActions: result.suggestedActions,
          createdAt: FieldValue.serverTimestamp(),
        },
        meetingNotes: result.markdown,
        nextSteps: nextSteps || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await logMeetingAudioAudit(auth.db, {
      companyId,
      userId: auth.caller.uid,
      recordId,
      action: "meeting_ai_summary_created",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI zápis selhal.";
    await ref.set(
      {
        aiSummary: { status: "failed", errorMessage: msg, createdAt: FieldValue.serverTimestamp() },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return NextResponse.json({ ok: false, error: msg, stage: "summary" }, { status: 502 });
  }
}
