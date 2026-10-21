import { NextResponse } from "next/server";
import { listProductTourAudioItems } from "@/lib/ai-tutor/product-demo-audio";

export const runtime = "nodejs";

export async function GET() {
  const steps = listProductTourAudioItems().map((x) => x.id).sort();
  return NextResponse.json(
    { v: 1, voice: "cs-CZ-VlastaNeural", steps },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
}
