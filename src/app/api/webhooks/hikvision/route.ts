import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Hik-Connect webhook push — implementace až s oficiálním podpisem (TODO).
 * Rychlá odpověď; zpracování oddělit do fronty.
 */
export async function POST(request: NextRequest) {
  // TODO(HIKCONNECT_WEBHOOK_SIGNATURE): ověř podpis dle Hikvision dokumentace
  void request;
  return NextResponse.json(
    {
      ok: false,
      error: "Webhook Hik-Connect není aktivní — chybí specifikace podpisu.",
    },
    { status: 501, headers: { "Cache-Control": "no-store" } }
  );
}
