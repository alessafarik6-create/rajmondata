import { generatePlainTextWithOpenAi } from "@/lib/ai/openai-client";

export type CampaignAiStyle = "professional" | "friendly" | "sales" | "brief";

const STYLE_HINT: Record<CampaignAiStyle, string> = {
  professional: "Profesionální, důvěryhodný tón.",
  friendly: "Přátelský, srozumitelný tón.",
  sales: "Obchodní, přesvědčivý tón bez agresivního nátlaku.",
  brief: "Stručný, výstižný tón.",
};

export type CampaignAiDraft = {
  title: string;
  shortDescription: string;
  bodyHtml: string;
  ctaLabel: string;
  emailSubject: string;
  emailIntro: string;
  needsTermsClarification?: boolean;
  clarificationNote?: string;
};

export async function generateOrgCampaignWithAi(input: {
  prompt: string;
  style: CampaignAiStyle;
  campaignType: string;
}): Promise<CampaignAiDraft> {
  const instructions = `Jsi copywriter platformy RAJMONDATA (CRM pro firmy).
Piš česky. Nevymýšlej konkrétní ceny, slevy ani smluvní podmínky, pokud nejsou v zadání — místo toho použij zástupný text [doplnit podmínky].
Vrať POUZE validní JSON objekt s klíči: title, shortDescription, bodyHtml (jednoduché HTML: p, ul, li, strong), ctaLabel, emailSubject, emailIntro, needsTermsClarification (boolean), clarificationNote (string nebo prázdný).
${STYLE_HINT[input.style]}`;

  const user = `Typ zprávy: ${input.campaignType}\nZadání administrátora:\n${input.prompt}`;

  const result = await generatePlainTextWithOpenAi(user, { instructions });
  const raw = result.outputText;

  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  const slice = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw;
  let parsed: CampaignAiDraft;
  try {
    parsed = JSON.parse(slice) as CampaignAiDraft;
  } catch {
    throw new Error("AI nevrátila platný JSON. Zkuste upřesnit zadání.");
  }
  return {
    title: String(parsed.title ?? "").trim().slice(0, 200),
    shortDescription: String(parsed.shortDescription ?? "").trim().slice(0, 500),
    bodyHtml: String(parsed.bodyHtml ?? "").trim().slice(0, 20_000),
    ctaLabel: String(parsed.ctaLabel ?? "Zjistit více").trim().slice(0, 80),
    emailSubject: String(parsed.emailSubject ?? "").trim().slice(0, 200),
    emailIntro: String(parsed.emailIntro ?? "").trim().slice(0, 2000),
    needsTermsClarification: Boolean(parsed.needsTermsClarification),
    clarificationNote: String(parsed.clarificationNote ?? "").trim().slice(0, 500) || undefined,
  };
}
