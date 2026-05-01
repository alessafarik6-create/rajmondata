/**
 * Jednotný editor anotací (nezařazené foto zaměření, měření u zakázky, fotodokumentace, PDF)
 * je vykreslen v `src/app/portal/jobs/[jobId]/page.tsx` jako `measurementAnnotationEditorDialog`.
 * Všechny vstupy (`?mp=`, `measurementPending`, `onAnnotatePhoto`) používají stejnou komponentu
 * a stejné nástroje (kóty, poznámka, značka/legenda, zoom, posun).
 *
 * Tento soubor exportuje sdílené typy; budoucí extrakce JSX může přejmenovat implementaci sem.
 */
export type {
  UniversalAnnotationRecord,
  UniversalAnnotationRecordType,
} from "./universal-annotation-record";
