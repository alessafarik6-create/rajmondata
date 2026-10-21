import { AI_TUTORIALS } from "@/lib/ai-tutor/tutorial-registry";
import { aiTutorSectionHint } from "@/lib/ai-tutor/section-hints";

const INJECTION_PATTERNS =
  /(ignore\s+(all\s+)?(previous|prior)\s+instructions|system\s+prompt|jailbreak|api[_\s-]?key|password|token)/i;

export function answerAiTutorQuestion(input: {
  question: string;
  pathname?: string;
  role?: string;
}): { answer: string; suggestedTutorialId?: string } {
  const q = String(input.question ?? "").trim();
  if (!q || q.length > 500) {
    return { answer: "Napište prosím stručný dotaz (max. 500 znaků)." };
  }
  if (INJECTION_PATTERNS.test(q)) {
    return {
      answer:
        "Na tento typ dotazu neodpovídám. Zeptejte se na práci v RAJMONDATA — zakázky, faktury, zaměstnance nebo nastavení.",
    };
  }

  const lower = q.toLowerCase();
  const hint = aiTutorSectionHint(input.pathname ?? "");

  const pickTutorial = (): string | undefined => {
    if (/zakáz|job|smlouv/.test(lower)) return "first-job";
    if (/zákazn|customer|crm/.test(lower)) return "first-customer";
    if (/zaměstn|employee|role|oprávn/.test(lower)) return "first-employee";
    if (/e-?mail|schrán|smtp/.test(lower)) return "connect-email";
    if (/faktur|záloh/.test(lower)) return "advance-invoice";
    if (/gps|vozov|fleet|satelit/.test(lower)) return "gps-fleet";
    if (/docházk|terminál/.test(lower)) return undefined;
    return undefined;
  };

  const tid = pickTutorial();
  const tut = tid ? AI_TUTORIALS.find((t) => t.id === tid) : undefined;

  if (tut) {
    return {
      answer: `${tut.summary} Spusťte průvodce „${tut.title}“ — provedu vás krok za krokem v rozhraní.`,
      suggestedTutorialId: tut.id,
    };
  }

  if (hint) {
    return {
      answer: `${hint.prompt} Můžete také vybrat průvodce v panelu AI učitele vpravo dole.`,
    };
  }

  return {
    answer:
      "Jsem AI průvodkyně RAJMONDATA. Zeptejte se na zakázky, zákazníky, faktury, e-mail nebo zaměstnance — nebo spusťte průvodce z nabídky.",
  };
}
