import { getOpenAiApiKey, getOpenAiModel, OPENAI_REQUEST_TIMEOUT_MS } from "@/lib/ai/config";
import type { OrganizationAiContextSnapshot } from "@/lib/ai/organization-ai-types";
import type { OrganizationAiAskResponse } from "@/lib/ai/organization-ai-types";
import { organizationAiEntityRef } from "@/lib/ai/organization-ai-entity-links";

const ASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    references: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string" },
          id: { type: "string" },
          label: { type: "string" },
        },
        required: ["type", "id", "label"],
      },
    },
    denied: { type: "boolean" },
  },
  required: ["answer", "references", "denied"],
} as const;

function questionNeedsFinance(q: string): boolean {
  const s = q.toLowerCase();
  return (
    s.includes("faktur") ||
    s.includes("finance") ||
    s.includes("splatnost") ||
    s.includes("cashflow") ||
    s.includes("nezaplacen") ||
    s.includes("uhrazen")
  );
}

function questionNeedsCameras(q: string): boolean {
  const s = q.toLowerCase();
  return s.includes("kamer") || s.includes("cctv") || s.includes("nvr");
}

function questionNeedsEmail(q: string): boolean {
  const s = q.toLowerCase();
  return (
    s.includes("e-mail") ||
    s.includes("email") ||
    s.includes("mail") ||
    s.includes("schránk") ||
    s.includes("nepřečten") ||
    s.includes("odpověd")
  );
}

function resolveEmailAccessAnswer(ctx: OrganizationAiContextSnapshot): string | null {
  if (ctx.emailAccess && !ctx.emailAccess.ok) {
    return ctx.emailAccess.userMessage;
  }
  if (!ctx.modulesEnabled.emails) {
    return "K modulu E-mail nemáte oprávnění.";
  }
  return null;
}

export async function answerOrganizationQuestion(input: {
  question: string;
  context: OrganizationAiContextSnapshot;
}): Promise<OrganizationAiAskResponse> {
  const q = input.question.trim();
  if (!q) {
    return { ok: true, answer: "Napište prosím dotaz.", references: [] };
  }

  const perms = input.context.permissions;
  const hasFinance =
    (perms.finance === "read" || perms.finance === "write" || perms.invoices === "read") &&
    input.context.finance != null;
  if (questionNeedsFinance(q) && !hasFinance) {
    return {
      ok: true,
      answer: "K finančním údajům nemáte oprávnění.",
      references: [],
      deniedModules: ["finance"],
    };
  }

  if (questionNeedsCameras(q) && !input.context.cameras) {
    return {
      ok: true,
      answer: "K modulu Kamery nemáte oprávnění nebo není aktivní.",
      references: [],
      deniedModules: ["cameras"],
    };
  }

  if (questionNeedsEmail(q)) {
    const blocked = resolveEmailAccessAnswer(input.context);
    if (blocked) {
      return { ok: true, answer: blocked, references: [], deniedModules: ["emails"] };
    }
  }

  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return answerDeterministic(q, input.context);
  }

  const system = `Jsi RAJMONDATA AI — firemní sekretářka. Odpovídej POUZE z JSON kontextu níže.
- Nevymýšlej čísla, zakázky, jména ani termíny.
- E-maily v kontextu jsou vždy z aktivní schránky přihlášeného uživatele (emailAccess / emails.mailboxId).
- Nikdy nepiš, že „modul e-mailů není aktivní“, pokud emailAccess.ok=true nebo emails obsahuje data.
- Pokud emailAccess.ok=false, použij userMessage z emailAccess.
- Pokud kontext neobsahuje odpověď, napiš: "Tyto informace nyní nemám k dispozici."
- Odpovídej česky, stručně, profesionálně.
- references: pouze entity, které jsou v kontextu se skutečným id (typ email pro zprávy).
- denied=true pouze pokud uživatel žádá data mimo kontext kvůli oprávnění (už řešeno).`;

  const userPrompt = JSON.stringify(
    {
      question: q,
      context: input.context,
    },
    null,
    2
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getOpenAiModel(),
        instructions: system,
        input: userPrompt,
        text: {
          format: {
            type: "json_schema",
            name: "org_ai_answer",
            strict: true,
            schema: ASK_SCHEMA,
          },
        },
      }),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      return answerDeterministic(q, input.context);
    }
    const data = JSON.parse(raw) as Record<string, unknown>;
    const output = extractOutputText(data);
    const parsed = JSON.parse(output) as {
      answer: string;
      references: Array<{ type: string; id: string; label: string }>;
      denied: boolean;
    };
    const references = (parsed.references ?? [])
      .map((r) => organizationAiEntityRef(r.type, r.id, r.label))
      .filter((x): x is NonNullable<typeof x> => x != null);
    return {
      ok: true,
      answer: String(parsed.answer ?? "").trim() || answerDeterministic(q, input.context).answer,
      references,
    };
  } catch {
    return answerDeterministic(q, input.context);
  } finally {
    clearTimeout(timer);
  }
}

function extractOutputText(data: Record<string, unknown>): string {
  const output = data.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (row.type === "message" && Array.isArray(row.content)) {
        for (const part of row.content) {
          if (!part || typeof part !== "object") continue;
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string" && p.text.trim()) return p.text.trim();
        }
      }
    }
  }
  const text = data.output_text;
  if (typeof text === "string" && text.trim()) return text.trim();
  throw new Error("no output");
}

function answerDeterministic(
  q: string,
  ctx: OrganizationAiContextSnapshot
): OrganizationAiAskResponse {
  const s = q.toLowerCase();
  const refs: OrganizationAiAskResponse["references"] = [];

  if (s.includes("hoří") || s.includes("pozornost")) {
    const lines: string[] = [];
    if (ctx.emails?.overdue) lines.push(`${ctx.emails.overdue} e-mailů čeká déle než 24 h.`);
    if (ctx.jobs?.overdue) lines.push(`${ctx.jobs.overdue} zakázek je po termínu.`);
    if (ctx.finance?.overdueInvoices)
      lines.push(`${ctx.finance.overdueInvoices} faktur je po splatnosti.`);
    if (!lines.length) {
      return { ok: true, answer: "Z dostupných dat teď nevidím urgentní problémy.", references: [] };
    }
    return { ok: true, answer: lines.map((l, i) => `${i + 1}. ${l}`).join("\n"), references: refs };
  }

  if (s.includes("rozpracovan") && s.includes("zakáz")) {
    const n = ctx.jobs?.active;
    if (n == null) return { ok: true, answer: "K zakázkám nemáte oprávnění.", references: [] };
    return { ok: true, answer: `Máte ${n} aktivních (otevřených) zakázek.`, references: [] };
  }

  if (ctx.finance && (s.includes("faktur") || s.includes("splatnost"))) {
    return {
      ok: true,
      answer: `Neuhrazených faktur: ${ctx.finance.unpaidInvoices}. Po splatnosti: ${ctx.finance.overdueInvoices}.`,
      references: (ctx.finance.overdueSamples ?? [])
        .map((i) => organizationAiEntityRef("invoice", i.id, i.label))
        .filter((x): x is NonNullable<typeof x> => x != null),
    };
  }

  if (ctx.cameras && s.includes("kamer")) {
    return {
      ok: true,
      answer: `Kamer celkem ${ctx.cameras.total}, online ${ctx.cameras.online}, offline ${ctx.cameras.offline}.`,
      references: [],
    };
  }

  if (questionNeedsEmail(q)) {
    const blocked = resolveEmailAccessAnswer(ctx);
    if (blocked) return { ok: true, answer: blocked, references: [] };
  }

  if (ctx.emails && questionNeedsEmail(q)) {
    const addr = ctx.emails.emailAddress ? ` (${ctx.emails.emailAddress})` : "";
    const lines: string[] = [];
    if (s.includes("nepřečten")) {
      lines.push(`Nepřečtených e-mailů: ${ctx.emails.unread ?? 0}${addr}.`);
    } else if (s.includes("neodpověd") || s.includes("čekaj") || s.includes("odpověd")) {
      lines.push(
        `E-maily čekající na odpověď: ${ctx.emails.waitingForReply}${addr}. Po lhůtě: ${ctx.emails.overdue}.`
      );
      for (const sample of ctx.emails.samples ?? []) {
        lines.push(`• ${sample.subject}${sample.sender ? ` — ${sample.sender}` : ""}`);
      }
    } else if (s.includes("termín") || s.includes("po lhůt")) {
      lines.push(`E-maily po termínu odpovědi: ${ctx.emails.overdue}${addr}.`);
    } else {
      lines.push(
        `Ve vaší schránce${addr}: ${ctx.emails.waitingForReply} čeká na odpověď, ${ctx.emails.overdue} po lhůtě, ${ctx.emails.unread ?? 0} nepřečtených.`
      );
    }
    const refs = (ctx.emails.samples ?? [])
      .slice(0, 5)
      .map((m) => organizationAiEntityRef("email", m.id, m.subject))
      .filter((x): x is NonNullable<typeof x> => x != null);
    return { ok: true, answer: lines.join("\n"), references: refs };
  }

  return {
    ok: true,
    answer: "Tyto informace nyní nemám k dispozici. Zkuste upřesnit dotaz (zakázky, e-maily, finance, kamery).",
    references: [],
  };
}
