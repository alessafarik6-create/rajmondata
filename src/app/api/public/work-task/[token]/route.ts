import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { resolveProductionTaskByPublicToken } from "@/lib/production-qr/resolve-public-token";

/** Veřejný náhled úkolu z QR — bez citlivých dat. */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Server není k dispozici." }, { status: 503 });
  }
  const { token } = await ctx.params;
  const resolved = await resolveProductionTaskByPublicToken(db, token);
  if (!resolved) {
    return NextResponse.json({ error: "Neplatný nebo zrušený QR kód." }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    jobName: resolved.jobDisplayName,
    task: {
      id: resolved.taskId,
      name: resolved.taskName,
      description: resolved.taskDescription,
      status: resolved.taskStatus,
    },
  });
}
