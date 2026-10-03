import { NextRequest, NextResponse } from "next/server";
import { requireMeetingAudioAccess } from "@/lib/meeting-audio/meeting-audio-api-auth";
import { appendMeetingAudioChunk } from "@/lib/meeting-audio/meeting-audio-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ recordId: string }> }
) {
  const { recordId } = await ctx.params;
  const companyId = String(request.nextUrl.searchParams.get("companyId") ?? "").trim();
  const uploadSessionId = String(request.nextUrl.searchParams.get("uploadSessionId") ?? "").trim();
  const chunkIndexRaw = request.nextUrl.searchParams.get("chunkIndex");
  const chunkIndex = Number(chunkIndexRaw);
  if (!companyId || !recordId || !uploadSessionId || !Number.isFinite(chunkIndex)) {
    return NextResponse.json({ ok: false, error: "Chybí parametry." }, { status: 400 });
  }

  const auth = await requireMeetingAudioAccess(request, companyId);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const form = await request.formData();
  const file = form.get("chunk");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: "Chybí chunk." }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "audio/webm";

  try {
    const { storagePath } = await appendMeetingAudioChunk(auth.db, {
      companyId,
      recordId,
      uploadSessionId,
      chunkIndex,
      bytes: buf,
      mimeType,
    });
    return NextResponse.json({ ok: true, storagePath, chunkIndex });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload selhal.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
