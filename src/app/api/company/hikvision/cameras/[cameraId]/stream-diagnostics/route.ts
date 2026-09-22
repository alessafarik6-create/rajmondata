import { NextRequest, NextResponse } from "next/server";
import { requireHikvisionIntegrationAdmin } from "@/lib/hikvision/api-auth";
import { hikvisionCamerasCol } from "@/lib/hikvision/stores";
import { HikvisionStreamGateway } from "@/lib/hikvision/stream-gateway";
import { formatStreamTrackMeta } from "@/lib/hikvision/ezopen-stream-meta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ cameraId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireHikvisionIntegrationAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { cameraId } = await params;
  let body: { companyId?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const companyId = String(body.companyId ?? auth.caller.companyId).trim();

  const camSnap = await hikvisionCamerasCol(auth.db, companyId).doc(cameraId).get();
  if (!camSnap.exists) {
    return NextResponse.json({ ok: false, error: "Kamera nenalezena." }, { status: 404 });
  }
  const cam = camSnap.data() as { name?: string; online?: boolean; channelId?: string | null };

  const gateway = new HikvisionStreamGateway(auth.db);
  const live = await gateway.startLiveSession({
    organizationId: companyId,
    cameraId,
    userId: auth.caller.uid,
    streamVariant: "sub",
    subCandidateIndex: 0,
  });

  return NextResponse.json(
    {
      ok: true,
      cameraId,
      cameraName: String(cam.name ?? cameraId),
      online: cam.online === true,
      firestoreChannelId: String(cam.channelId ?? "1"),
      snapshot: "OK",
      mainStream: live.ok
        ? live.mainStream
        : null,
      subStream: live.ok ? live.subStream ?? null : null,
      mainStreamLabel: live.ok && live.mainStream ? formatStreamTrackMeta(live.mainStream) : null,
      subStreamLabel: live.ok && live.subStream ? formatStreamTrackMeta(live.subStream) : null,
      webLive: live.ok
        ? {
            selectedStream: live.streamVariant,
            channelNo: live.channelNo,
            streamType: live.streamType,
            codec: live.codecHint,
            selectionReason: live.webLiveSelectionReason,
            subCandidateIndex: live.subCandidateIndex,
            warning: live.webLiveWarning ?? null,
            liveApi: "OK",
          }
        : {
            liveApi: "Error",
            code: live.ok ? undefined : live.code,
            error: live.ok ? undefined : live.error,
          },
      runtimeNote:
        "Received bytes / decoded / rendered frames jsou dostupné v prohlížeči po otevření live náhledu (getHikvisionPlayerRuntimeDiagnostics).",
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
