export const SECRETARY_OPEN_JOB_EVENT = "rajmondata-secretary-open-job";

export type SecretaryOpenJobDetail = {
  jobId: string;
  portalPath: string;
};

export function dispatchSecretaryOpenJob(detail: SecretaryOpenJobDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SECRETARY_OPEN_JOB_EVENT, { detail }));
}
