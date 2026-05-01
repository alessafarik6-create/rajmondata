/**
 * Klíč do IndexedDB u `storePendingJobMeasurementFile` pro režim „zařadím později“
 * (nesouvisí s URL — ponecháno kvůli zpětné kompatibilitě uloženým draftům).
 */
export const MEASUREMENT_PHOTO_PENDING_EDITOR_ROUTE_JOB_ID =
  "__measurement_editor_pending__";

/** Kanonická cesta editoru nezařazeného / dashboard měření (bez umělého jobId v URL). */
export const MEASUREMENT_PHOTO_ANNOTATE_PAGE_PATH =
  "/portal/jobs/measurement-annotate" as const;
