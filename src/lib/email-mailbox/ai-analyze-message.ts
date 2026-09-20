import type { Firestore } from "firebase-admin/firestore";
import { getOpenAiApiKey, getOpenAiModel, isAiFeatureEnabled } from "@/lib/ai/config";
import type { EmailMessageDoc } from "@/lib/email-mailbox/types";
import {
  normalizeAiCategory,
  normalizeAiPriority,
  type EmailAiCategory,
  type EmailAiPriority,
} from "@/lib/email-mailbox/intelligence-types";
import { suggestEmailJobLinks } from "@/lib/email-mailbox/job-link-suggest";

export type EmailAiAnalysis = {
  summary: string;
  category: EmailAiCategory;
  priority: EmailAiPriority;
  needsReply: boolean;
  requiresAction: boolean;
  suggestedCustomerId?: string | null;
  suggestedJobId?: string | null;
  suggestedInquiryId?: string | null;
  suggestedCustomerName?: string | null;
  suggestedJobLabel?: string | null;
  jobMatchConfidence?: "low" | "medium" | "high";
  suggestedActions: string[];
  inquiryDraft?: Record<string, unknown> | null;
  insights?: string[];
};

const ALLOWED_ATTACHMENT_HINTS = ["pdf", "jpg", "jpeg", "png", "docx", "xlsx"];

export async function analyzeEmailMessageWithAi(
  db: Firestore,
  companyId: string,
  message: Pick<
    EmailMessageDoc,
    "subject" | "textBody" | "from" | "attachments" | "htmlBody"
  >
): Promise<EmailAiAnalysis | null> {
  if (!isAiFeatureEnabled()) return null;
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return null;

  const body =
    (message.textBody ?? "").trim() ||
    String(message.htmlBody ?? "")
      .replace(/<[^>]+>/g, " ")
      .slice(0, 8000);

  const attachmentNames = (message.attachments ?? [])
    .map((a) => a.filename)
    .filter((n) => ALLOWED_ATTACHMENT_HINTS.some((ext) => n.toLowerCase().endsWith(ext)));

  const prompt = `Analyzuj příchozí firemní e-mail (CRM montážní/řemeslnické firmy). Vrať JSON:
{
  "summary": "1-2 věty",
  "category": "INQUIRY|JOB|INVOICE|DOCUMENT|ORDER|COMPLAINT|SUPPLIER|CUSTOMER|INTERNAL|OTHER",
  "priority": "LOW|NORMAL|HIGH|URGENT",
  "needsReply": true/false,
  "requiresAction": true/false,
  "suggestedActions": ["..."],
  "insights": ["krátké věty pro uživatele"],
  "inquiryDraft": { "name": "", "email": "", "phone": "", "text": "", "type": "", "dimensions": "" } nebo null
}
Nikdy nenavrhuj smazání ani označení spam — to dělá uživatel.
Od: ${message.from}. Předmět: ${message.subject}. Přílohy: ${attachmentNames.join(", ") || "—"}.
Text:\n${body.slice(0, 6000)}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getOpenAiModel(),
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Jsi asistent pro třídění e-mailů ve firmě. Nikdy neuváděj hesla. Vrať validní JSON.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) return null;
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as Partial<EmailAiAnalysis & { category: string }>;
    const category = normalizeAiCategory(parsed.category);
    const priority = normalizeAiPriority(parsed.priority);
    const link = await suggestEmailJobLinks(db, companyId, {
      from: message.from,
      subject: message.subject,
      textBody: body,
    });

    const needsReply = Boolean(parsed.needsReply);
    const requiresAction = Boolean(parsed.requiresAction) || needsReply;

    return {
      summary: String(parsed.summary ?? "").slice(0, 500),
      category,
      priority,
      needsReply,
      requiresAction,
      suggestedActions: Array.isArray(parsed.suggestedActions)
        ? parsed.suggestedActions.map(String).slice(0, 8)
        : [],
      inquiryDraft:
        parsed.inquiryDraft && typeof parsed.inquiryDraft === "object"
          ? (parsed.inquiryDraft as Record<string, unknown>)
          : category === "INQUIRY"
            ? { email: message.from, text: body.slice(0, 2000), source: "email" }
            : null,
      insights: Array.isArray(parsed.insights)
        ? parsed.insights.map(String).slice(0, 6)
        : [],
      suggestedCustomerId: link.customerId,
      suggestedJobId: link.jobId,
      suggestedCustomerName: link.customerName,
      suggestedJobLabel: link.jobLabel,
      jobMatchConfidence: link.confidence,
      suggestedInquiryId: null,
    };
  } catch {
    return null;
  }
}

export type AiReplyTone = "default" | "shorter" | "formal" | "friendly";

export async function suggestEmailReplyDraft(
  message: Pick<EmailMessageDoc, "subject" | "textBody" | "from" | "htmlBody">,
  opts?: {
    tone?: AiReplyTone;
    threadContext?: string;
    companyRules?: string;
  }
): Promise<string | null> {
  if (!isAiFeatureEnabled()) return null;
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return null;
  const body =
    (message.textBody ?? "").trim() ||
    String(message.htmlBody ?? "")
      .replace(/<[^>]+>/g, " ")
      .slice(0, 6000);

  const toneHint =
    opts?.tone === "shorter"
      ? "Buď stručný (max 6 vět)."
      : opts?.tone === "formal"
        ? "Formální obchodní styl."
        : opts?.tone === "friendly"
          ? "Přátelský, ale profesionální tón."
          : "Profesionální styl.";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getOpenAiModel(),
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: `Napiš návrh odpovědi v češtině. Jen draft — bez odeslání. ${toneHint} Bez vymyšlených cen.${
            opts?.companyRules ? `\nPravidla firmy: ${opts.companyRules.slice(0, 1500)}` : ""
          }`,
        },
        {
          role: "user",
          content: `Předmět: ${message.subject}\nOd: ${message.from}\n${
            opts?.threadContext ? `Kontext vlákna:\n${opts.threadContext.slice(0, 4000)}\n\n` : ""
          }Poslední zpráva:\n${body.slice(0, 5000)}`,
        },
      ],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content?.trim() ?? null;
}
