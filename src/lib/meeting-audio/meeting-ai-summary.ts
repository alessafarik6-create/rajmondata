import { getOpenAiApiKey, getOpenAiModel, OPENAI_REQUEST_TIMEOUT_MS } from "@/lib/ai/config";
import { OpenAiClientError } from "@/lib/ai/openai-client";
import type {
  MeetingAiSuggestedActions,
  MeetingAiSummaryStructured,
} from "@/lib/meeting-records-media-types";

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    shortSummary: { type: "string" },
    mainPoints: { type: "array", items: { type: "string" } },
    agreed: { type: "array", items: { type: "string" } },
    tasks: { type: "array", items: { type: "string" } },
    deadlines: { type: "array", items: { type: "string" } },
    amounts: { type: "array", items: { type: "string" } },
    customerRequirements: { type: "array", items: { type: "string" } },
    openQuestions: { type: "array", items: { type: "string" } },
    doNotForget: { type: "array", items: { type: "string" } },
    nextSteps: { type: "array", items: { type: "string" } },
    uncertainNotes: { type: "array", items: { type: "string" } },
    suggestedActions: {
      type: "object",
      additionalProperties: false,
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              dueDate: { type: ["string", "null"] },
              assignedTo: { type: ["string", "null"] },
              sourceQuote: { type: ["string", "null"] },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["title", "confidence"],
          },
        },
      },
      required: ["tasks"],
    },
  },
  required: [
    "shortSummary",
    "mainPoints",
    "agreed",
    "tasks",
    "deadlines",
    "amounts",
    "customerRequirements",
    "openQuestions",
    "doNotForget",
    "nextSteps",
    "suggestedActions",
  ],
} as const;

function formatSummaryMarkdown(s: MeetingAiSummaryStructured): string {
  const lines: string[] = ["SHRNUTÍ SCHŮZKY", "", "Krátký souhrn:", s.shortSummary, ""];
  const section = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push(title);
    for (const x of items) lines.push(`• ${x}`);
    lines.push("");
  };
  section("HLAVNÍ BODY", s.mainPoints);
  section("DOHODNUTO", s.agreed);
  section("ÚKOLY", s.tasks);
  section("TERMÍNY", s.deadlines);
  section("ČÁSTKY", s.amounts);
  section("POŽADAVKY ZÁKAZNÍKA", s.customerRequirements);
  section("OTEVŘENÉ OTÁZKY", s.openQuestions);
  if (s.doNotForget.length) {
    lines.push("DŮLEŽITÉ – NEZAPOMENOUT");
    for (const x of s.doNotForget) lines.push(`⚠ ${x}`);
    lines.push("");
  }
  if (s.nextSteps.length) {
    lines.push("DALŠÍ KROKY");
    s.nextSteps.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
    lines.push("");
  }
  if (s.uncertainNotes?.length) {
    lines.push("Nejisté / vyžaduje kontrolu");
    for (const x of s.uncertainNotes) lines.push(`• ${x}`);
  }
  return lines.join("\n");
}

export async function generateMeetingAiSummaryFromTranscript(
  transcript: string
): Promise<{
  structured: MeetingAiSummaryStructured;
  markdown: string;
  suggestedActions: MeetingAiSuggestedActions;
}> {
  const key = getOpenAiApiKey();
  if (!key) throw new OpenAiClientError(503, "OpenAI API není nakonfigurováno.");
  const trimmed = transcript.trim();
  if (!trimmed) throw new OpenAiClientError(400, "Chybí přepis.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS * 2);

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: getOpenAiModel(),
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "Jsi asistent pro zápisy schůzek ve stavební firmě v Česku. " +
                  "Vycházej POUZE z přepisu a metadat — nevymýšlej rozhodnutí, částky, termíny ani účastníky. " +
                  "Rozlišuj návrh od skutečně dohodnutého (dohodnuté do agreed, návrhy do uncertainNotes). " +
                  "Nejisté body dej do uncertainNotes. " +
                  "Jména mluvčích nevymýšlej — použij Speaker 1/2 jen pokud jsou v přepisu. " +
                  "Úkoly v tasks piš stručně; suggestedActions.tasks jen s vysokou jistotou.",
              },
            ],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: trimmed.slice(0, 120_000) }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "meeting_summary",
            schema: SUMMARY_SCHEMA,
            strict: true,
          },
        },
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      output?: Array<{ content?: Array<{ text?: string }> }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new OpenAiClientError(
        res.status >= 500 ? 502 : 400,
        data.error?.message || `Summary HTTP ${res.status}`
      );
    }

    const rawText =
      data.output?.flatMap((o) => o.content?.map((c) => c.text).filter(Boolean) ?? []).join("") ??
      "";
    const parsed = JSON.parse(rawText) as MeetingAiSummaryStructured & {
      suggestedActions?: MeetingAiSuggestedActions;
    };

    const structured: MeetingAiSummaryStructured = {
      shortSummary: parsed.shortSummary ?? "",
      mainPoints: parsed.mainPoints ?? [],
      agreed: parsed.agreed ?? [],
      tasks: parsed.tasks ?? [],
      deadlines: parsed.deadlines ?? [],
      amounts: parsed.amounts ?? [],
      customerRequirements: parsed.customerRequirements ?? [],
      openQuestions: parsed.openQuestions ?? [],
      doNotForget: parsed.doNotForget ?? [],
      nextSteps: parsed.nextSteps ?? [],
      uncertainNotes: parsed.uncertainNotes ?? [],
    };

    const suggestedActions: MeetingAiSuggestedActions = {
      tasks: (parsed.suggestedActions?.tasks ?? []).map((t) => ({
        title: t.title,
        description: t.description,
        dueDate: t.dueDate ?? null,
        assignedTo: t.assignedTo ?? null,
        sourceQuote: t.sourceQuote ?? null,
        confidence: t.confidence ?? "medium",
        selected: t.confidence === "high",
      })),
      appointments: parsed.suggestedActions?.appointments ?? [],
      customerUpdates: parsed.suggestedActions?.customerUpdates ?? [],
      jobUpdates: parsed.suggestedActions?.jobUpdates ?? [],
    };

    return {
      structured,
      markdown: formatSummaryMarkdown(structured),
      suggestedActions,
    };
  } finally {
    clearTimeout(timer);
  }
}
