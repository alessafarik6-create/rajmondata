import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { normalizeTerminalPin } from "@/lib/terminal-pin-validation";
import { resolveProductionTaskByPublicToken } from "@/lib/production-qr/resolve-public-token";
import { verifyProductionQrPin } from "@/lib/production-qr/production-pin-guard";
import { getRequestIp } from "@/lib/production-qr/request-ip";
import { stopProductionTimeViaQr } from "@/lib/production-qr/production-time-server";

type Body = { employeeId?: string; pin?: string };

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Server není k dispozici." }, { status: 503 });
  }
  const { token } = await ctx.params;
  const resolved = await resolveProductionTaskByPublicToken(db, token);
  if (!resolved) {
    return NextResponse.json({ error: "Neplatný QR kód." }, { status: 404 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON." }, { status: 400 });
  }

  const employeeId = String(body.employeeId ?? "").trim();
  const pin = normalizeTerminalPin(body.pin != null ? String(body.pin) : "");
  if (!employeeId || !pin) {
    return NextResponse.json({ error: "Chybí zaměstnanec nebo PIN." }, { status: 400 });
  }

  const pinCheck = await verifyProductionQrPin(db, {
    companyId: resolved.companyId,
    employeeId,
    pinNormalized: pin,
    ip: getRequestIp(request),
    route: "/api/public/work-task/[token]/stop",
  });
  if (!pinCheck.ok) {
    return NextResponse.json({ error: pinCheck.error }, { status: pinCheck.status });
  }

  const result = await stopProductionTimeViaQr(db, {
    companyId: resolved.companyId,
    employeeId,
    productionTaskId: resolved.taskId,
    jobId: resolved.jobId,
  });

  if (!result.stopped) {
    return NextResponse.json({ error: "Nemáte spuštěnou práci na tomto úkolu." }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    endedAt: result.endedAt,
    durationSeconds: result.durationSeconds,
  });
}
