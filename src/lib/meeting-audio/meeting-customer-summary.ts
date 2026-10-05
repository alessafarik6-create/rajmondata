import { getOpenAiApiKey, getOpenAiModel, OPENAI_REQUEST_TIMEOUT_MS } from "@/lib/ai/config";
import { OpenAiClientError } from "@/lib/ai/openai-client";

export async function generateCustomerFacingMeetingSummary(internalMarkdown: string): Promise<string> {
  const key = getOpenAiApiKey();
  if (!key) throw new OpenAiClientError(503, "OpenAI API není nakonfigurováno.");
  const trimmed = internalMarkdown.trim();
  if (!trimmed) throw new OpenAiClientError(400, "Chybí interní zápis.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS * 2);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: getOpenAiModel(),
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "Přepiš interní zápis schůzky do čisté verze pro zákazníka v češtině. " +
              "Odstraň interní poznámky, nejistoty a interní úkoly týmu. " +
              "Nevymýšlej nové informace. Zachovej dohodnutá fakta a další kroky relevantní pro zákazníka.",
          },
          { role: "user", content: trimmed.slice(0, 24_000) },
        ],
      }),
    });
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new OpenAiClientError(
        res.status >= 500 ? 502 : 400,
        data.error?.message || `Customer summary HTTP ${res.status}`
      );
    }
    return String(data.choices?.[0]?.message?.content ?? "").trim();
  } finally {
    clearTimeout(timer);
  }
}
