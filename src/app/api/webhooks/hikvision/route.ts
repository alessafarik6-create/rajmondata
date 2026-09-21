import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * HikCentral Connect OpenAPI používá pro alarmy **pull** (mq/messages), ne push webhook v dokumentaci.
 * Endpoint ponechán pro budoucí integraci jiných Hik produktů — bez důvěryhodné specifikace nezpracovává tělo.
 */
export async function POST(request: NextRequest) {
  void request;
  return NextResponse.json(
    {
      ok: false,
      error:
        "Hik-Connect Cloud alarmy se stahují přes OpenAPI mq/messages — webhook v HCC dokumentaci není. Není nutné nastavovat v portálu.",
    },
    { status: 501, headers: { "Cache-Control": "no-store" } }
  );
}
