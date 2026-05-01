/**
 * Jednotný editor anotací (foto zaměření, fotodokumentace, obrázky, PDF) je implementován
 * v `src/app/portal/jobs/[jobId]/page.tsx` jako `measurementAnnotationEditorDialog` — logika je
 * zde proložena dalšími handlery zakázky, proto zatím není jako samostatný strom souborů.
 *
 * Tento modul slouží jako stabilní importní bod pro sdílené typy a budoucí přesun UI.
 */
export type {
  UniversalAnnotationRecord,
  UniversalAnnotationRecordType,
} from "./universal-annotation-record";
