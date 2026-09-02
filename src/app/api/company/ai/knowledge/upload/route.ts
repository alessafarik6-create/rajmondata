import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Legacy multipart upload — nahrazeno přímým uploadem do Firebase Storage + /knowledge/process.
 * Vrací vždy JSON (nikdy plain text), aby frontend nepadal na response.json().
 */
export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      {
        ok: false,
        error: "UPLOAD_METHOD_DEPRECATED",
        message:
          "Přímý upload souboru přes API je vypnutý. Soubor se nahrává do Firebase Storage a zpracuje přes /api/company/ai/knowledge/process.",
      },
      { status: 410 }
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: "USE_PROCESS_ENDPOINT",
      message: "Použijte endpoint /api/company/ai/knowledge/process s metadaty souboru.",
    },
    { status: 400 }
  );
}
