/**
 * Pole šablony předávacího protokolu — bez údajů vázaných na konkrétní zakázku.
 */

import {
  defaultHandoverAcceptanceText,
  newHandoverDefectRow,
  type HandoverDefectRow,
  type HandoverProtocolForm,
} from "@/lib/handover-protocol-types";

export type HandoverProtocolTemplateContent = {
  documentTitle: string;
  deliveredWork: string;
  completedWorkDescription: string;
  handoverNote: string;
  defects: HandoverDefectRow[];
  handedDocumentation: string;
  handedManuals: string;
  handedKeys: string;
  otherHandedItems: string;
  acceptanceText: string;
};

export function handoverTemplateContentFromForm(
  form: HandoverProtocolForm
): HandoverProtocolTemplateContent {
  const defects = Array.isArray(form.defects) ? form.defects : [];
  return {
    documentTitle: form.documentTitle.trim() || "Předávací protokol",
    deliveredWork: form.deliveredWork.trim(),
    completedWorkDescription: form.completedWorkDescription.trim(),
    handoverNote: form.handoverNote.trim(),
    defects: defects.map((d) => ({
      id: String(d.id ?? newHandoverDefectRow().id),
      description: String(d.description ?? "").trim(),
      removalDeadline: String(d.removalDeadline ?? "").trim(),
      status: d.status === "in_progress" || d.status === "resolved" ? d.status : "open",
    })),
    handedDocumentation: form.handedDocumentation.trim(),
    handedManuals: form.handedManuals.trim(),
    handedKeys: form.handedKeys.trim(),
    otherHandedItems: form.otherHandedItems.trim(),
    acceptanceText: form.acceptanceText.trim() || defaultHandoverAcceptanceText(),
  };
}

/** Aplikuje šablonu; zachová datum předání, číslo protokolu a job-specific snapshot. */
export function applyHandoverTemplateToForm(
  current: HandoverProtocolForm,
  template: HandoverProtocolTemplateContent
): HandoverProtocolForm {
  const defects = (template.defects ?? []).map((d) => ({
    ...d,
    id: newHandoverDefectRow().id,
  }));
  return {
    ...current,
    documentTitle: template.documentTitle.trim() || current.documentTitle,
    deliveredWork: template.deliveredWork,
    completedWorkDescription: template.completedWorkDescription,
    handoverNote: template.handoverNote,
    defects,
    handedDocumentation: template.handedDocumentation,
    handedManuals: template.handedManuals,
    handedKeys: template.handedKeys,
    otherHandedItems: template.otherHandedItems,
    acceptanceText: template.acceptanceText.trim() || current.acceptanceText,
  };
}
