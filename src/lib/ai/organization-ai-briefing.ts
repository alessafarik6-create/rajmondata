import type {
  OrganizationAiBriefingItem,
  OrganizationAiBriefingResponse,
  OrganizationAiContextSnapshot,
} from "@/lib/ai/organization-ai-types";
import { organizationAiEntityRef } from "@/lib/ai/organization-ai-entity-links";

export function czechTimeGreeting(now = new Date()): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "Dobré ráno";
  if (h >= 12 && h < 18) return "Dobré odpoledne";
  return "Dobrý večer";
}

function vocativeFirstName(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0] ?? displayName;
  if (!first) return displayName;
  if (first.endsWith("a") && first.length > 2) return `${first.slice(0, -1)}o`;
  if (first.endsWith("e")) return first;
  return first;
}

export function buildOrganizationBriefing(
  ctx: OrganizationAiContextSnapshot
): OrganizationAiBriefingResponse {
  const items: OrganizationAiBriefingItem[] = [];
  const firstName = vocativeFirstName(ctx.user.displayName);

  if (ctx.emails) {
    if (ctx.emails.overdue > 0) {
      items.push({
        priority: "URGENT",
        icon: "🔥",
        text: `${ctx.emails.overdue} e-mailů čeká na odpověď déle než 24 hodin`,
      });
    } else if (ctx.emails.waitingForReply > 0) {
      items.push({
        priority: "HIGH",
        icon: "✉",
        text: `${ctx.emails.waitingForReply} e-mailů čeká na odpověď`,
      });
    }
    if (ctx.emails.urgent > 0) {
      items.push({
        priority: "HIGH",
        icon: "⚡",
        text: `${ctx.emails.urgent} urgentních e-mailů`,
      });
    }
    for (const s of ctx.emails.samples ?? []) {
      const ref = organizationAiEntityRef("email", s.id, s.subject);
      if (ref) {
        items.push({
          priority: "NORMAL",
          icon: "✉",
          text: `E-mail: ${s.subject}`,
          ref,
        });
      }
    }
  }

  if (ctx.jobs?.overdue) {
    items.push({
      priority: "HIGH",
      icon: "⚠",
      text: `${ctx.jobs.overdue} zakázek je po termínu`,
    });
    for (const j of ctx.jobs.overdueSamples ?? []) {
      const ref = organizationAiEntityRef("job", j.id, j.name);
      items.push({
        priority: "HIGH",
        icon: "⚠",
        text: `Zakázka ${j.name} je ${j.daysOverdue} dní po termínu`,
        ref: ref ?? undefined,
      });
    }
  }

  if (ctx.documents?.pendingClassification) {
    items.push({
      priority: "NORMAL",
      icon: "📄",
      text: `${ctx.documents.pendingClassification} dokladů čeká na zařazení`,
    });
  }

  if (ctx.finance?.overdueInvoices) {
    items.push({
      priority: "HIGH",
      icon: "💰",
      text: `${ctx.finance.overdueInvoices} faktur je po splatnosti`,
    });
    for (const inv of ctx.finance.overdueSamples ?? []) {
      const ref = organizationAiEntityRef("invoice", inv.id, inv.label);
      items.push({
        priority: "HIGH",
        icon: "💰",
        text: `Faktura ${inv.label} je po splatnosti`,
        ref: ref ?? undefined,
      });
    }
  }

  if (ctx.calendar) {
    const parts: string[] = [];
    if (ctx.calendar.todayMeetings) parts.push(`${ctx.calendar.todayMeetings} schůzky`);
    if (ctx.calendar.todayInstallations) parts.push(`${ctx.calendar.todayInstallations} montáže`);
    if (parts.length) {
      items.push({
        priority: "NORMAL",
        icon: "📅",
        text: `Dnes: ${parts.join(" a ")}`,
      });
    }
  }

  if (ctx.production?.waiting) {
    items.push({
      priority: "NORMAL",
      icon: "🏭",
      text: `Ve výrobě čeká ${ctx.production.waiting} položek`,
    });
  }

  if (ctx.cameras && ctx.cameras.offline > 0) {
    items.push({
      priority: "HIGH",
      icon: "📷",
      text: `${ctx.cameras.offline} kamer je offline`,
    });
  }

  if (ctx.leads?.newRecent) {
    items.push({
      priority: "INFO",
      icon: "📥",
      text: `${ctx.leads.newRecent} nedávných poptávek v inboxu`,
    });
  }

  const priorityOrder = { URGENT: 0, HIGH: 1, NORMAL: 2, INFO: 3 };
  items.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const attention = items.filter((i) => i.priority !== "INFO").length;
  const greeting = `${czechTimeGreeting()}, ${firstName}.`;

  let intro: string;
  if (attention === 0) {
    intro = "Z dostupných dat teď nevidím nic urgentního. Můžete se zeptat na konkrétní oblast firmy.";
  } else if (attention === 1) {
    intro = "Dnes jsem našla 1 věc, která potřebuje vaši pozornost.";
  } else if (attention >= 2 && attention <= 4) {
    intro = `Dnes jsem našla ${attention} věci, které potřebují vaši pozornost.`;
  } else {
    intro = `Dnes jsem našla ${attention} věcí, které potřebují vaši pozornost.`;
  }

  const detailParts: string[] = [];
  if (ctx.emails?.waitingForReply && ctx.emails.waitingForReply > 0) {
    detailParts.push(
      `Dnes bych doporučila věnovat pozornost ${ctx.emails.waitingForReply} e-mailům čekajícím na odpověď.`
    );
  }
  if (ctx.jobs?.overdueSamples?.[0]) {
    const j = ctx.jobs.overdueSamples[0];
    detailParts.push(`Zakázka ${j.name} je po termínu.`);
  }
  if (ctx.finance?.overdueInvoices) {
    detailParts.push(`${ctx.finance.overdueInvoices} faktury jsou po splatnosti.`);
  }
  if (ctx.calendar?.nextEventLabel) {
    detailParts.push(`Dnes v kalendáři: ${ctx.calendar.nextEventLabel}.`);
  }
  if (detailParts.length) {
    intro = `${intro} ${detailParts.join(" ")}`.trim();
  }

  return {
    ok: true,
    greeting,
    intro,
    items: items.slice(0, 12),
    attentionCount: attention,
    contextGeneratedAt: ctx.generatedAt,
  };
}

export function buildHotTodayItems(ctx: OrganizationAiContextSnapshot): OrganizationAiBriefingItem[] {
  const briefing = buildOrganizationBriefing(ctx);
  return briefing.items.filter((i) => i.priority === "URGENT" || i.priority === "HIGH").slice(0, 8);
}
