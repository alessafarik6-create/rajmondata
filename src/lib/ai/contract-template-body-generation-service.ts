import type { Firestore } from "firebase-admin/firestore";
import { CONTRACT_TEMPLATE_BODY_SYSTEM_PROMPT } from "@/lib/ai/contract-template-body-system-prompt";
import { generatePlainTextWithOpenAi, OpenAiClientError } from "@/lib/ai/openai-client";
import { retrieveKnowledgeForQuery } from "@/lib/ai/knowledge-service";
import { CONTRACT_TEMPLATES_COLLECTION } from "@/lib/contract-templates-firestore";

export type ContractTemplateAiMode = "generate" | "regenerate" | "improve";

export type ContractTemplateAiScope = "short" | "standard" | "detailed";
export type ContractTemplateAiStyle = "professional" | "formal";

function excerpt(text: string, max: number): string {
  const t = String(text ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export async function generateContractTemplateBodyText(params: {
  db: Firestore;
  companyId: string;
  mode: ContractTemplateAiMode;
  contractType: string;
  scope: ContractTemplateAiScope;
  style: ContractTemplateAiStyle;
  userBrief: string;
  existingContent?: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string; status: number }> {
  const brief = String(params.userBrief ?? "").trim();
  if (brief.length < 12) {
    return {
      ok: false,
      error: "Popište, co má šablona řešit (alespoň několik slov).",
      status: 400,
    };
  }

  const companySnap = await params.db.collection("companies").doc(params.companyId).get();
  if (!companySnap.exists) {
    return { ok: false, error: "Organizace neexistuje.", status: 404 };
  }
  const company = companySnap.data() as Record<string, unknown>;
  const companyName = String(company.companyName ?? company.name ?? "").trim();

  const templatesSnap = await params.db
    .collection(CONTRACT_TEMPLATES_COLLECTION)
    .where("companyId", "==", params.companyId)
    .limit(8)
    .get();

  const styleSamples = templatesSnap.docs
    .map((d) => {
      const data = d.data() as { name?: string; content?: string };
      return {
        name: String(data.name ?? "").trim(),
        excerpt: excerpt(String(data.content ?? ""), 1200),
      };
    })
    .filter((s) => s.excerpt.length > 40)
    .slice(0, 3);

  let knowledgeExcerpts: string[] = [];
  try {
    const hits = await retrieveKnowledgeForQuery(params.db, params.companyId, brief, 4);
    knowledgeExcerpts = hits
      .map((h) => excerpt(String(h.text ?? ""), 800))
      .filter((t) => t.length > 20);
  } catch (e) {
    console.warn("[contract-template-ai] knowledge retrieve skipped", e);
  }

  const scopeHint =
    params.scope === "short"
      ? "Rozsah: stručný — jen nejdůležitější ustanovení."
      : params.scope === "detailed"
        ? "Rozsah: podrobný — více sekcí a detailů, stále univerzální šablona."
        : "Rozsah: standardní — vyvážený počet sekcí.";

  const styleHint =
    params.style === "formal"
      ? "Styl: formální právní formulace (bez falešných konkrétních údajů)."
      : "Styl: běžný profesionální business styl.";

  const modeHint =
    params.mode === "improve"
      ? "Uživatel má existující text šablony — uprav ho podle požadavku (zachovej smysl, doplň/chybějící ustanovení). Vrať celý upravený text těla."
      : params.mode === "regenerate"
        ? "Připrav nový návrh těla šablony podle zadání (nahraď předchozí návrh)."
        : "Připrav první návrh těla univerzální smluvní šablony.";

  const userPrompt = [
    modeHint,
    scopeHint,
    styleHint,
    "",
    `Typ smlouvy (kontext): ${params.contractType || "Smlouva o dílo"}`,
    companyName ? `Organizace (jen pro tón, ne vkládej do textu jako stranu): ${companyName}` : "",
    "",
    "POŽADAVEK UŽIVATELE:",
    brief,
    "",
    styleSamples.length
      ? [
          "INSPIRACE — výňatky z existujících šablon STEJNÉ organizace (styl, ne kopírovat 1:1):",
          JSON.stringify(styleSamples, null, 2),
        ].join("\n")
      : "",
    knowledgeExcerpts.length
      ? ["PODKLADY Z AI CENTRA (pouze pro tuto organizaci):", knowledgeExcerpts.join("\n---\n")].join(
          "\n"
        )
      : "",
    params.existingContent?.trim()
      ? ["SOUČASNÝ TEXT ŠABLONY (tělo):", excerpt(params.existingContent.trim(), 14000)].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await generatePlainTextWithOpenAi(userPrompt, {
      instructions: CONTRACT_TEMPLATE_BODY_SYSTEM_PROMPT,
    });
    const text = result.outputText.trim();
    if (!text) {
      return {
        ok: false,
        error: "Návrh se nepodařilo vytvořit. Zkuste to znovu.",
        status: 502,
      };
    }
    return { ok: true, text };
  } catch (err) {
    if (err instanceof OpenAiClientError) {
      return {
        ok: false,
        error: err.userMessage || "Návrh se nepodařilo vytvořit. Zkuste to znovu.",
        status: err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502,
      };
    }
    return { ok: false, error: "Návrh se nepodařilo vytvořit. Zkuste to znovu.", status: 502 };
  }
}
