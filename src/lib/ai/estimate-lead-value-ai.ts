/**
 * Lehký AI odhad hodnoty poptávky (bez plné nabídky) — ukládá se na overlay.
 */

import type { Firestore } from "firebase-admin/firestore";
import type { LeadImportRow } from "@/lib/lead-import-parse";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { generatePlainTextWithOpenAi } from "@/lib/ai/openai-client";
import {
  loadAiAssistantSettings,
  loadAiInquiryTypeRules,
  resolveInquiryTypeRule,
} from "@/lib/ai/inquiry-type-rules";

export type LeadValueAiEstimate = {
  estimatedPriceNet: number;
  estimatedPriceGross: number;
  confidence: number;
  source: "AI_ESTIMATE";
};

function parseEstimateJson(text: string): LeadValueAiEstimate | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const o = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const net = Number(o.estimatedPriceNet ?? o.estimated_price_net);
    const gross = Number(o.estimatedPriceGross ?? o.estimated_price_gross);
    const confidence = Number(o.confidence ?? 0.5);
    if (!Number.isFinite(gross) || gross <= 0) return null;
    const netOk = Number.isFinite(net) && net > 0 ? net : gross;
    return {
      estimatedPriceNet: Math.round(netOk),
      estimatedPriceGross: Math.round(gross),
      confidence: Math.min(1, Math.max(0.1, confidence)),
      source: "AI_ESTIMATE",
    };
  } catch {
    return null;
  }
}

export async function estimateLeadValueWithAi(
  db: Firestore,
  companyId: string,
  leadKey: string,
  lead: LeadImportRow
): Promise<LeadValueAiEstimate | null> {
  const [settings, typeRules, overlaySnap] = await Promise.all([
    loadAiAssistantSettings(db, companyId),
    loadAiInquiryTypeRules(db, companyId),
    db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("import_lead_overlays")
      .doc(leadKey)
      .get(),
  ]);

  if (!settings.enabled) return null;

  const ov = (overlaySnap.data() ?? {}) as Record<string, unknown>;
  const typ = lead.typ || String(ov.typ ?? ov.typ_poptavky ?? "").trim();
  const typeRule = resolveInquiryTypeRule(typ || "Obecná poptávka", typeRules);

  const prompt = `Odhadni orientační tržní hodnotu poptávky v Kč (ČR). Nevydávej falešnou přesnost.
Typ: ${typ || "neuvedeno"} (${typeRule.name})
Text: ${(lead.zprava || String(ov.zprava ?? "")).slice(0, 2000)}
Adresa: ${lead.adresa || String(ov.adresa ?? "")}
Pravidla typu: ${typeRule.quoteRules?.slice(0, 500) ?? typeRule.name}

Vrať POUZE JSON:
{"estimatedPriceNet":number,"estimatedPriceGross":number,"confidence":0.0-1.0,"source":"AI_ESTIMATE"}`;

  const res = await generatePlainTextWithOpenAi(prompt, {
    instructions:
      "Jsi odhadce hodnot stavebních poptávek. Vrať jen JSON. Gross = s DPH pokud je to běžné u B2C, jinak uveď obě částky konzistentně.",
  });

  return parseEstimateJson(res.outputText);
}
