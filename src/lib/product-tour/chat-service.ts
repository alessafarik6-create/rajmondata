import { getOpenAiApiKey, getOpenAiModel, OPENAI_REQUEST_TIMEOUT_MS } from "@/lib/ai/config";
import {
  formatKnowledgeContext,
  retrieveProductTourKnowledge,
} from "@/lib/product-tour/knowledge-retrieval";
import { sanitizeDemoActions, inferDemoActionsFromQuestion, type DemoAction } from "@/lib/product-tour/demo-actions";

const INJECTION =
  /(ignore\s+(all\s+)?(previous|prior)\s+instructions|system\s+prompt|jailbreak|api[_\s-]?key|password|token)/i;

export type ProductTourChatMessage = { role: "user" | "assistant"; content: string };

export type ProductTourChatResult = {
  answer: string;
  demoActions: DemoAction[];
  offerContinueTour: boolean;
  usedLlm: boolean;
};

function fallbackAnswer(question: string): ProductTourChatResult {
  const mods = retrieveProductTourKnowledge(question, 3);
  const actions = inferDemoActionsFromQuestion(question);
  if (mods.length === 0) {
    return {
      answer:
        "Na toto nemám v ověřených materiálech přesnou odpověď. Rád vás ale provedu demem nebo předám kontakt na podporu na webu RAJMONDATA. Chcete pokračovat v prohlídce?",
      demoActions: actions,
      offerContinueTour: true,
      usedLlm: false,
    };
  }
  const m = mods[0]!;
  let answer = `${m.description} ${m.howToUse}`;
  if (/cena|kolik|stát|zdarma|10\s*zaměst/.test(question.toLowerCase())) {
    answer += ` ${m.pricingNote} Aktuální ceník najdete na stránce Ceník — neuvádím čísla, která nejsou v materiálech ověřená.`;
  }
  if (actions.length > 1) {
    answer += " Můžu vám to hned ukázat v demu vpravo.";
  }
  return { answer, demoActions: actions, offerContinueTour: true, usedLlm: false };
}

export async function answerProductTourChat(input: {
  question: string;
  history?: ProductTourChatMessage[];
  companyType?: string | null;
  tourMode?: string | null;
}): Promise<ProductTourChatResult> {
  const question = String(input.question ?? "").trim().slice(0, 800);
  if (!question) {
    return { answer: "Napište nebo řekněte dotaz.", demoActions: [], offerContinueTour: false, usedLlm: false };
  }
  if (INJECTION.test(question)) {
    return {
      answer: "Ptám se jen na funkce RAJMONDATA. Zeptejte se na zakázky, faktury, docházku nebo ceník.",
      demoActions: [],
      offerContinueTour: false,
      usedLlm: false,
    };
  }

  const mods = retrieveProductTourKnowledge(question, 6);
  const context = formatKnowledgeContext(mods);
  const apiKey = getOpenAiApiKey();

  if (!apiKey) {
    return fallbackAnswer(question);
  }

  const system = `Jsi česká AI obchodní průvodkyně RAJMONDATA na veřejné prohlídce /prohlidka.
Pravidla:
- Odpovídej výhradně česky, přirozeně a stručně (max 120 slov).
- Používej POUZE ověřený kontext níže. Nevymýšlej moduly ani ceny.
- Pokud nevíš, přiznej to a nabídněte ceník nebo registraci.
- Nikdy nepožaduj hesla ani interní data organizací.
- Typ firmy návštěvníka: ${input.companyType ?? "neuvedeno"}.
- Režim prohlídky: ${input.tourMode ?? "neuvedeno"}.

Kontext modulů:
${context}

Vrať JSON: {"answer": string, "demoActions": array, "offerContinueTour": boolean}
demoActions povolené typy: navigateDemoModule (module), highlightDemoElement (highlight), showDemoWorkflow (workflowId, stepIndex), pauseTour, resumeTour, continueTour.
Pokud uživatel chce ukázku, vlož demoActions.`;

  const messages = [
    { role: "system" as const, content: system },
    ...(input.history ?? []).slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 600) })),
    { role: "user" as const, content: question },
  ];

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS);
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getOpenAiModel(),
        temperature: 0.35,
        response_format: { type: "json_object" },
        messages,
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return fallbackAnswer(question);
    const parsed = JSON.parse(raw) as {
      answer?: string;
      demoActions?: unknown;
      offerContinueTour?: boolean;
    };
    const answer = String(parsed.answer ?? "").trim() || fallbackAnswer(question).answer;
    let demoActions = sanitizeDemoActions(parsed.demoActions);
    if (demoActions.length === 0 && /ukáž|ukaž|předve|jak.*vytvoř|jak funguje/.test(question.toLowerCase())) {
      demoActions = inferDemoActionsFromQuestion(question);
    }
    return {
      answer,
      demoActions,
      offerContinueTour: Boolean(parsed.offerContinueTour),
      usedLlm: true,
    };
  } catch {
    return fallbackAnswer(question);
  }
}
