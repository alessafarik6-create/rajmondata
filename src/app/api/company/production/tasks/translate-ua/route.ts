import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { canManageProductionTasks } from "@/lib/production-qr/production-access";
import {
  generatePlainTextWithOpenAi,
  OpenAiClientError,
} from "@/lib/ai/openai-client";

type Body = { name?: string; description?: string };

export async function POST(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  if (!canManageProductionTasks(v.caller)) {
    return NextResponse.json({ error: "Překlad může použít vedení." }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON." }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const description = String(body.description ?? "").trim();
  if (!name && !description) {
    return NextResponse.json({ error: "Chybí text k překladu." }, { status: 400 });
  }

  const prompt = `Přelož následující výrobní úkol z češtiny do ukrajinštiny pro dílnu / montáž.
Zachovej odborné termíny (sváření, montáž, konstrukce). Vrať POUZE validní JSON bez markdown:
{"nameUk":"...","descriptionUk":"..."}

Název (CS): ${name || "—"}
Popis (CS): ${description || "—"}`;

  try {
    const ai = await generatePlainTextWithOpenAi(prompt, {
      instructions:
        "Jsi překladatel technických výrobních textů CS→UA. Odpovídej jen JSON objektem nameUk a descriptionUk.",
    });
    const raw = ai.outputText;
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    const slice = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw;
    const parsed = JSON.parse(slice) as { nameUk?: string; descriptionUk?: string };
    return NextResponse.json({
      ok: true,
      nameUk: String(parsed.nameUk ?? "").trim() || null,
      descriptionUk: String(parsed.descriptionUk ?? "").trim() || null,
    });
  } catch (e) {
    if (e instanceof OpenAiClientError) {
      return NextResponse.json({ error: e.userMessage }, { status: e.statusCode });
    }
    console.error("[production/tasks/translate-ua]", e);
    return NextResponse.json({ error: "Překlad se nezdařil." }, { status: 500 });
  }
}
