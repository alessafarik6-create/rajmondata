import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { generateOrgCampaignWithAi, type CampaignAiStyle } from "@/lib/platform-org-campaigns/ai-generate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as { prompt?: string; style?: CampaignAiStyle; type?: string };
  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "Chybí zadání pro AI." }, { status: 400 });
  try {
    const draft = await generateOrgCampaignWithAi({
      prompt,
      style: body.style ?? "professional",
      campaignType: String(body.type ?? "offer"),
    });
    return NextResponse.json({ ok: true, draft });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI selhalo.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
