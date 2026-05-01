/**
 * Jednotný editor anotací (nezařazené foto zaměření, měření u zakázky, fotodokumentace, PDF)
 * je vykreslen v `src/app/portal/jobs/[jobId]/page.tsx` jako `measurementAnnotationEditorDialog`.
 * Vstup: `openPhotoAnnotationEditor` / `openMeasurementPhotoAnnotationFromRow` (stejný dialog jako
 * `JobMediaSection` → `onAnnotatePhoto`). Všechny vstupy (`?mp=`, `measurementPending`) sdílejí nástroje
 * (kóty, poznámka, značka/legenda, zoom, posun).
 *
 * Tento soubor exportuje sdílené typy; budoucí extrakce JSX může přejmenovat implementaci sem.
 */
export type {
  UniversalAnnotationRecord,
  UniversalAnnotationRecordType,
} from "./universal-annotation-record";
