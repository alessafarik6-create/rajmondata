import type { DemoHighlight, DemoView } from "@/lib/ai-tutor/product-demo-script";

export type DemoAction =
  | { type: "navigateDemoModule"; module: DemoView }
  | { type: "highlightDemoElement"; highlight: DemoHighlight }
  | { type: "showDemoWorkflow"; workflowId: string; stepIndex?: number }
  | { type: "explainDemoFeature"; featureId: string }
  | { type: "pauseTour" }
  | { type: "resumeTour" }
  | { type: "continueTour" };

const ALLOWED_VIEWS = new Set<string>([
  "dashboard",
  "jobs-list",
  "jobs-form",
  "job-detail",
  "contract",
  "email-compose",
  "customers",
  "team",
  "email-ai",
  "invoices",
  "finance",
  "warehouse",
  "production",
  "gps",
  "cta",
]);

const ALLOWED_HIGHLIGHTS = new Set<string>([
  "nav-jobs",
  "btn-new-job",
  "field-customer",
  "btn-save-job",
  "btn-contract",
  "btn-send-email",
  "nav-team",
  "nav-email",
  "nav-invoices",
  "nav-warehouse",
  "nav-fleet",
  "ai-widget",
]);

const ALLOWED_WORKFLOWS = new Set(["lead-to-invoice", "job-create"]);

export function sanitizeDemoActions(raw: unknown): DemoAction[] {
  if (!Array.isArray(raw)) return [];
  const out: DemoAction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const t = (item as { type?: string }).type;
    if (t === "navigateDemoModule") {
      const module = String((item as { module?: string }).module ?? "");
      if (ALLOWED_VIEWS.has(module)) out.push({ type: t, module: module as DemoView });
    } else if (t === "highlightDemoElement") {
      const highlight = String((item as { highlight?: string }).highlight ?? "");
      if (ALLOWED_HIGHLIGHTS.has(highlight))
        out.push({ type: t, highlight: highlight as DemoHighlight });
    } else if (t === "showDemoWorkflow") {
      const workflowId = String((item as { workflowId?: string }).workflowId ?? "");
      const stepIndex = (item as { stepIndex?: number }).stepIndex;
      if (ALLOWED_WORKFLOWS.has(workflowId))
        out.push({
          type: t,
          workflowId,
          stepIndex: typeof stepIndex === "number" ? stepIndex : undefined,
        });
    } else if (t === "explainDemoFeature") {
      const featureId = String((item as { featureId?: string }).featureId ?? "").slice(0, 40);
      if (featureId) out.push({ type: t, featureId });
    } else if (t === "pauseTour" || t === "resumeTour" || t === "continueTour") {
      out.push({ type: t });
    }
  }
  return out.slice(0, 8);
}

/** Heuristické demo akce z dotazu, pokud LLM není k dispozici. */
export function inferDemoActionsFromQuestion(q: string): DemoAction[] {
  const s = q.toLowerCase();
  const actions: DemoAction[] = [{ type: "pauseTour" }];
  if (/ukáž|ukaž|předve|vytvoř.*zakáz|nová zakáz/.test(s)) {
    actions.push(
      { type: "navigateDemoModule", module: "jobs-list" },
      { type: "highlightDemoElement", highlight: "btn-new-job" },
      { type: "navigateDemoModule", module: "jobs-form" }
    );
  } else if (/smlouv/.test(s)) {
    actions.push(
      { type: "navigateDemoModule", module: "job-detail" },
      { type: "highlightDemoElement", highlight: "btn-contract" }
    );
  } else if (/faktur|poslat.*zákaz/.test(s)) {
    actions.push(
      { type: "navigateDemoModule", module: "invoices" },
      { type: "navigateDemoModule", module: "email-compose" }
    );
  } else if (/sklad|výrob|vyrob/.test(s)) {
    actions.push({ type: "navigateDemoModule", module: "warehouse" });
  } else if (/gps|vozid|auto/.test(s)) {
    actions.push({ type: "navigateDemoModule", module: "gps" });
  } else if (/docházk|zaměstn|tablet/.test(s)) {
    actions.push(
      { type: "navigateDemoModule", module: "team" },
      { type: "highlightDemoElement", highlight: "nav-team" }
    );
  } else if (/e-?mail|schrán/.test(s)) {
    actions.push({ type: "navigateDemoModule", module: "email-ai" });
  } else if (/proces|poptáv|nabíd|až po faktur/.test(s)) {
    actions.push({ type: "showDemoWorkflow", workflowId: "lead-to-invoice", stepIndex: 0 });
  }
  return actions;
}
