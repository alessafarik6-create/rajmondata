/**
 * AI nápověda portálu (server) — registry, manuály, oprávnění.
 */

import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import {
  buildPortalHelpRegistry,
  searchPortalHelpRegistry,
  serializePortalHelpForPrompt,
  type PortalHelpRegistryEntry,
} from "@/lib/portal-help-registry";
import {
  canAccessPortalModule,
  portalModuleIdFromPathname,
  portalPermissionsAllowMutation,
  type PortalModuleId,
} from "@/lib/portal-permissions";
import { resolveCallerPortalPermissions } from "@/lib/portal-permissions-server";
import { isAiFeatureEnabled } from "@/lib/ai/config";
import { generatePlainTextWithOpenAi } from "@/lib/ai/openai-client";
import { parseKnowledgeQueryIntent } from "@/lib/ai/knowledge-query-intent";
import { retrieveKnowledgeForQuery } from "@/lib/ai/knowledge-service";
import { getPortalAssistantReply, type PortalAssistantReply } from "@/lib/portal-assistant-knowledge";

export type PortalAssistantAnswer = PortalAssistantReply & {
  usedAi?: boolean;
};

function filterRegistryByPermissions(
  registry: PortalHelpRegistryEntry[],
  permissions: Record<PortalModuleId, import("@/lib/portal-permissions").PortalAccessLevel>
): PortalHelpRegistryEntry[] {
  return registry.filter((e) => canAccessPortalModule(permissions, e.module, "read"));
}

function permissionSummaryForPrompt(
  permissions: Record<PortalModuleId, import("@/lib/portal-permissions").PortalAccessLevel>,
  role: string
): string {
  const lines: string[] = [];
  for (const e of buildPortalHelpRegistry()) {
    const level = permissions[e.module] ?? "none";
    const canWrite = portalPermissionsAllowMutation(permissions, e.module, role);
    lines.push(`${e.title} (${e.module}): ${level}${canWrite ? " + zápis" : ""}`);
  }
  return lines.join("\n");
}

function registryQuickReply(
  entry: PortalHelpRegistryEntry,
  question: string,
  permissions: Record<PortalModuleId, import("@/lib/portal-permissions").PortalAccessLevel>,
  role: string
): PortalAssistantAnswer {
  const n = question.toLowerCase();
  const needsWrite =
    /(vytvor|vytvoř|nov(a|ou|y)|pridat|přidat|smazat|upravit|zmenit|změnit|odeslat|pregenerovat|přegenerovat)/i.test(
      n
    );
  const module = entry.module;
  const canWrite = portalPermissionsAllowMutation(permissions, module, role);

  if (needsWrite && !canWrite) {
    return {
      text:
        `K modulu „${entry.title}“ máte v účtu pouze oprávnění Náhled.\n\n` +
        `Akci z otázky („${question.trim()}“) nemůžete provést — potřebujete Zápis. ` +
        `Požádejte vlastníka nebo administrátora o úpravu oprávnění u zaměstnance.\n\n` +
        `Sekci pro prohlížení najdete zde: ${entry.route}`,
      openHref: entry.route,
      openLabel: `Otevřít ${entry.title}`,
      usedAi: false,
    };
  }

  const steps =
    entry.actions.length > 0
      ? entry.actions.slice(0, 4).map((a, i) => `${i + 1}) ${a}`).join("\n")
      : `1) Otevřete ${entry.title}.\n2) Postupujte podle obrazovky.`;

  return {
    text:
      `${entry.title} — ${entry.helpText}\n\n` +
      (entry.workflows ? `Typický tok: ${entry.workflows}\n\n` : "") +
      `Postup:\n${steps}`,
    openHref: entry.route,
    openLabel: `Otevřít ${entry.title}`,
    usedAi: false,
  };
}

function parseAssistantJson(text: string): PortalAssistantReply | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const reply = String(o.text ?? o.answer ?? "").trim();
    if (!reply) return null;
    const openHref =
      typeof o.openHref === "string" && o.openHref.startsWith("/portal/")
        ? o.openHref
        : undefined;
    const openLabel = typeof o.openLabel === "string" ? o.openLabel : undefined;
    return { text: reply, openHref, openLabel };
  } catch {
    return null;
  }
}

export async function answerPortalAssistantQuestion(params: {
  db: Firestore;
  caller: VerifiedCompanyCaller;
  question: string;
  pathname: string;
}): Promise<PortalAssistantAnswer> {
  const question = params.question.trim();
  const permissions = await resolveCallerPortalPermissions(params.db, params.caller);
  const registry = filterRegistryByPermissions(buildPortalHelpRegistry(), permissions);

  const hit = searchPortalHelpRegistry(question, registry);
  if (hit) {
    const special =
      /v(i|í)cepr(a|á)ci|vicepraci/.test(question.toLowerCase()) &&
      hit.module === "jobs";
    if (special) {
      return {
        text:
          "Vícepráci přidáte v detailu zakázky:\n\n" +
          "1) Otevřete Zakázky a zvolte konkrétní zakázku.\n" +
          "2) V sekci Položkový rozpočet / fakturační položky zvolte Nová položka.\n" +
          "3) Označte položku jako vícepráci (typ / příznak dle formuláře).\n" +
          "4) Uložte — položka se promítne do rozpočtu a fakturace.",
        openHref: params.pathname.startsWith("/portal/jobs/") ? params.pathname : "/portal/jobs",
        openLabel: "Otevřít zakázky",
        usedAi: false,
      };
    }
    return registryQuickReply(hit, question, permissions, params.caller.role);
  }

  let knowledgeBlock = "";
  try {
    void parseKnowledgeQueryIntent(question);
    const hits = await retrieveKnowledgeForQuery(
      params.db,
      params.caller.companyId,
      question,
      4
    );
    if (hits.length > 0) {
      knowledgeBlock =
        "\n\nÚryvky z firemních manuálů (AI centrum):\n" +
        hits
          .map(
            (h, i) =>
              `[${i + 1}] ${h.documentTitle ?? h.fileName}: ${h.text.slice(0, 400)}`
          )
          .join("\n");
    }
  } catch {
    /* manuály nejsou povinné */
  }

  if (isAiFeatureEnabled()) {
    const portalCtx = serializePortalHelpForPrompt(registry, params.pathname);
    const permCtx = permissionSummaryForPrompt(permissions, params.caller.role);
    const currentModule = portalModuleIdFromPathname(params.pathname) ?? "overview";

    const prompt = `Otázka uživatele: ${question}

${portalCtx}

Oprávnění uživatele (role ${params.caller.role}):
${permCtx}

${knowledgeBlock}

Vrať JSON: {"text":"krátká praktická odpověď v češtině","openHref":"/portal/... nebo null","openLabel":"popisek tlačítka nebo null"}
Pravidla: 1) kde to je 2) co kliknout 3) co uložit. Pokud nemá WRITE, upozorni. Nepiš, že měníš data. openHref jen z výše uvedených rout.`;

    try {
      const res = await generatePlainTextWithOpenAi(prompt, {
        instructions:
          "Jsi AI nápověda RajmonData portálu. Odpovídej stručně, prakticky, jen JSON na konci nebo celý JSON.",
      });
      const parsed = parseAssistantJson(res.outputText);
      if (parsed) {
        return { ...parsed, usedAi: true };
      }
      return { text: res.outputText.trim().slice(0, 2000), usedAi: true };
    } catch {
      /* fallback níže */
    }
  }

  const legacy = getPortalAssistantReply(question, params.pathname);
  return { ...legacy, usedAi: false };
}
