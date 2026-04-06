/**
 * Job template system: types and constants.
 * Templates define dynamic sections and fields for jobs (e.g. Pergola dimensions, Family house rooms).
 */

import type { JobQuestionnaireTemplate } from "@/lib/job-customer-questionnaire";

export const JOB_TEMPLATE_FIELD_TYPES = [
  'short_text',
  'long_text',
  'number',
  'measurement',
  'checkbox',
  'select',
  'date',
  'notes',
] as const;

export type JobTemplateFieldType = (typeof JOB_TEMPLATE_FIELD_TYPES)[number];

export interface JobTemplateFieldOption {
  value: string;
  label: string;
}

export interface JobTemplateField {
  id: string;
  type: JobTemplateFieldType;
  label: string;
  required?: boolean;
  placeholder?: string;
  /** For type 'select' */
  options?: JobTemplateFieldOption[];
  /** Default value */
  defaultValue?: string | number | boolean;
}

export interface JobTemplateSection {
  id: string;
  name: string;
  order: number;
  fields: JobTemplateField[];
}

export interface JobTemplate {
  id?: string;
  name: string;
  productType: string;
  description?: string;
  sections: JobTemplateSection[];
  /** Dotazník pro zákazníka u zakázek vytvořených z této šablony. */
  questionnaire?: JobQuestionnaireTemplate | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/** Values stored on a job for template fields. Key: sectionId_fieldId or fieldId. */
export type JobTemplateValues = Record<string, string | number | boolean | null>;

export const JOB_TEMPLATE_FIELD_LABELS: Record<JobTemplateFieldType, string> = {
  short_text: 'Krátký text',
  long_text: 'Dlouhý text / popis',
  number: 'Číslo',
  measurement: 'Rozměr (m, cm, …)',
  checkbox: 'Ano/Ne',
  select: 'Výběr z možností',
  date: 'Datum',
  notes: 'Poznámka',
};
