import type { Firestore } from "firebase-admin/firestore";
import { getOpenAiApiKey, getOpenAiModel, isAiFeatureEnabled } from "@/lib/ai/config";
import type { EmailMessageDoc } from "@/lib/email-mailbox/types";

export type EmailAiAnalysis = {
  summary: string;
  category: string;
  priority: "low" | "normal" | "high";
  needsReply: boolean;
  suggestedCustomerId?: string | null;
  suggestedJobId?: string | null;
  suggestedInquiryId?: string | null;
  suggestedActions: string[];
  inquiryDraft?: Record<string, unknown> | null;
};

const ALLOWED_ATTACHMENT_HINTS = ["pdf", "jpg", "jpeg", "png", "docx", "xlsx"];

export async function analyzeEmailMessageWithAi(
  _db: Firestore,
  _companyId: string,
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
  "category": "poptávka|fakturace|servis|interní|spam|jiné",
  "priority": "low|normal|high",
  "needsReply": true/false,
  "suggestedActions": ["..."],
  "inquiryDraft": { "name": "", "email": "", "phone": "", "text": "", "type": "", "dimensions": "" } nebo null
}
Neposílej credentials. Od: ${message.from}. Předmět: ${message.subject}. Přílohy: ${attachmentNames.join(", ") || "—"}.
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
    const parsed = JSON.parse(content) as Partial<EmailAiAnalysis>;
    return {
      summary: String(parsed.summary ?? "").slice(0, 500),
      category: String(parsed.category ?? "jiné").slice(0, 80),
      priority:
        parsed.priority === "high" || parsed.priority === "low" ? parsed.priority : "normal",
      needsReply: Boolean(parsed.needsReply),
      suggestedActions: Array.isArray(parsed.suggestedActions)
        ? parsed.suggestedActions.map(String).slice(0, 8)
        : [],
      inquiryDraft:
        parsed.inquiryDraft && typeof parsed.inquiryDraft === "object"
          ? (parsed.inquiryDraft as Record<string, unknown>)
          : null,
      suggestedCustomerId: null,
      suggestedJobId: null,
      suggestedInquiryId: null,
    };
  } catch {
    return null;
  }
}

export async function suggestEmailReplyDraft(
  message: Pick<EmailMessageDoc, "subject" | "textBody" | "from" | "htmlBody">
): Promise<string | null> {
  if (!isAiFeatureEnabled()) return null;
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return null;
  const body =
    (message.textBody ?? "").trim() ||
    String(message.htmlBody ?? "")
      .replace(/<[^>]+>/g, " ")
      .slice(0, 6000);

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
          content:
            "Napiš návrh profesionální odpovědi v češtině. Jen draft — bez odeslání. Bez vymyšlených cen.",
        },
        {
          role: "user",
          content: `Předmět: ${message.subject}\nOd: ${message.from}\n\n${body.slice(0, 5000)}`,
        },
      ],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content?.trim() ?? null;
}
