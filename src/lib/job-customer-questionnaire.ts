/**
 * Dotazníky pro zákazníka u zakázky — šablona (jobTemplates) a instance (odpovědi u jobs).
 */

export const JOB_QUESTIONNAIRE_QUESTION_TYPES = [
  "short_text",
  "long_text",
  "radio",
  "checkbox_multi",
  "date",
  "birth_date",
  "number",
  "yes_no",
] as const;

export type JobQuestionnaireQuestionType = (typeof JOB_QUESTIONNAIRE_QUESTION_TYPES)[number];

export interface JobQuestionnaireOption {
  value: string;
  label: string;
}

export interface JobQuestionnaireQuestion {
  id: string;
  label: string;
  type: JobQuestionnaireQuestionType;
  required: boolean;
  order: number;
  options?: JobQuestionnaireOption[];
  placeholder?: string;
}

export interface JobQuestionnaireTemplate {
  title: string;
  description?: string;
  active: boolean;
  questions: JobQuestionnaireQuestion[];
  /** ID šablony zakázky, pokud byl dotazník zkopírován ze šablony. */
  templateId?: string;
}

export const JOB_QUESTIONNAIRE_QUESTION_LABELS: Record<JobQuestionnaireQuestionType, string> = {
  short_text: "Krátký text",
  long_text: "Dlouhý text",
  radio: "Výběr jedné možnosti (puntík)",
  checkbox_multi: "Výběr více možností",
  date: "Datum",
  birth_date: "Datum narození",
  number: "Číslo",
  yes_no: "Ano / ne",
};

export function defaultEmptyQuestionnaireTemplate(): JobQuestionnaireTemplate {
  return {
    title: "Dotazník pro zákazníka",
    description: "",
    active: true,
    questions: [],
  };
}

function isQuestionType(x: unknown): x is JobQuestionnaireQuestionType {
  return typeof x === "string" && (JOB_QUESTIONNAIRE_QUESTION_TYPES as readonly string[]).includes(x);
}

function parseOptions(raw: unknown): JobQuestionnaireOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: JobQuestionnaireOption[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const m = o as Record<string, unknown>;
    const value = typeof m.value === "string" ? m.value : "";
    const label = typeof m.label === "string" ? m.label : value;
    if (value) out.push({ value, label: label || value });
  }
  return out.length ? out : undefined;
}

export function parseJobQuestionnaireQuestion(raw: unknown): JobQuestionnaireQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const id = typeof m.id === "string" && m.id.trim() ? m.id.trim() : "";
  const label = typeof m.label === "string" ? m.label : "";
  if (!id || !label.trim()) return null;
  const type = isQuestionType(m.type) ? m.type : "short_text";
  const order = typeof m.order === "number" && Number.isFinite(m.order) ? m.order : 0;
  return {
    id,
    label: label.trim(),
    type,
    required: m.required === true,
    order,
    options: parseOptions(m.options),
    placeholder: typeof m.placeholder === "string" ? m.placeholder : undefined,
  };
}

export function normalizeJobQuestionnaireTemplate(raw: unknown): JobQuestionnaireTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const title = typeof m.title === "string" && m.title.trim() ? m.title.trim() : "";
  if (!title) return null;
  const questionsRaw = Array.isArray(m.questions) ? m.questions : [];
  const questions = questionsRaw
    .map(parseJobQuestionnaireQuestion)
    .filter((q): q is JobQuestionnaireQuestion => q !== null)
    .sort((a, b) => a.order - b.order);
  const templateId =
    typeof m.templateId === "string" && m.templateId.trim() ? m.templateId.trim() : undefined;

  return {
    title,
    description: typeof m.description === "string" ? m.description : undefined,
    active: m.active !== false,
    questions,
    ...(templateId ? { templateId } : {}),
  };
}

export function cloneQuestionnaireTemplateForJob(
  tpl: JobQuestionnaireTemplate,
  templateId?: string | null
): JobQuestionnaireTemplate & { templateId?: string } {
  const questions = [...tpl.questions]
    .sort((a, b) => a.order - b.order)
    .map((q, i) => ({ ...q, order: i }));
  return {
    title: tpl.title,
    description: tpl.description,
    active: tpl.active,
    questions,
    ...(templateId ? { templateId } : {}),
  };
}

export type QuestionnaireAnswerValue = string | number | boolean | string[];

export function parseAnswersMap(raw: unknown): Record<string, QuestionnaireAnswerValue> {
  if (!raw || typeof raw !== "object") return {};
  const m = raw as Record<string, unknown>;
  const out: Record<string, QuestionnaireAnswerValue> = {};
  for (const [k, v] of Object.entries(m)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      out[k] = v as string[];
    }
  }
  return out;
}

function isEmptyValue(q: JobQuestionnaireQuestion, v: QuestionnaireAnswerValue | undefined): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (typeof v === "number") return !Number.isFinite(v);
  if (typeof v === "boolean") return false;
  if (Array.isArray(v)) return v.length === 0;
  return true;
}

export function validateQuestionnaireAnswers(
  questions: JobQuestionnaireQuestion[],
  answers: Record<string, QuestionnaireAnswerValue>
): Record<string, string> {
  const errors: Record<string, string> = {};
  const sorted = [...questions].sort((a, b) => a.order - b.order);
  for (const q of sorted) {
    if (!q.required) continue;
    const v = answers[q.id];
    if (isEmptyValue(q, v)) {
      errors[q.id] = "Toto pole je povinné.";
      continue;
    }
    if (q.type === "number") {
      const n = typeof v === "number" ? v : Number(typeof v === "string" ? v : "");
      if (!Number.isFinite(n)) errors[q.id] = "Zadejte platné číslo.";
    }
  }
  return errors;
}

export function normalizeAnswerForType(
  q: JobQuestionnaireQuestion,
  raw: string | string[] | undefined
): QuestionnaireAnswerValue | undefined {
  if (raw === undefined) return undefined;
  if (q.type === "checkbox_multi") {
    const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
    return arr.filter((x) => typeof x === "string" && x.length > 0);
  }
  if (q.type === "yes_no") {
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    return undefined;
  }
  if (q.type === "number") {
    const s = Array.isArray(raw) ? raw[0] : raw;
    if (typeof s !== "string" || s.trim() === "") return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }
  const s = Array.isArray(raw) ? raw[0] ?? "" : raw;
  return typeof s === "string" ? s : String(s);
}
