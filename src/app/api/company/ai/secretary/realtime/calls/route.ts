import { NextRequest } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { exchangeSecretaryRealtimeSdp } from "@/lib/ai/secretary/realtime-sdp-handler";

/** @deprecated Prefer POST /api/company/ai/secretary/realtime with Content-Type: application/sdp */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return new Response(JSON.stringify({ error: "server_not_configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sdpRaw = await request.text();

  return exchangeSecretaryRealtimeSdp(
    {
      sdpRaw,
      authHeader: request.headers.get("authorization") || "",
      companyIdParam: request.nextUrl.searchParams.get("companyId"),
    },
    db,
    auth
  );
}
