export type SatelitniProblemJson = {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  errors?: unknown;
};

export function parseProblemJson(raw: string): SatelitniProblemJson {
  try {
    return JSON.parse(raw) as SatelitniProblemJson;
  } catch {
    return { detail: raw.slice(0, 500) };
  }
}

export function userMessageFromProblem(status: number, problem: SatelitniProblemJson): string {
  if (status === 403) {
    return (
      problem.detail?.trim() ||
      "K přístupu k těmto údajům nemá propojený účet SatelitníSledování.cz potřebné oprávnění."
    );
  }
  if (status === 401) {
    return problem.detail?.trim() || "Platnost přístupu vypršela. Zkuste znovu připojit účet.";
  }
  if (status === 404) {
    return problem.detail?.trim() || "Požadovaný záznam v GPS systému nebyl nalezen.";
  }
  if (status === 409) {
    return problem.detail?.trim() || "Konflikt dat GPS (409).";
  }
  if (status === 422) {
    return problem.detail?.trim() || "Neplatná data požadavku (422).";
  }
  if (status === 429) {
    return "Vyčerpán limit API SatelitníSledování.cz. Zkuste to později.";
  }
  if (status >= 500) {
    return problem.detail?.trim() || "Chyba služby SatelitníSledování.cz.";
  }
  return problem.detail?.trim() || problem.title?.trim() || `GPS API vrátilo HTTP ${status}.`;
}

export class SatelitniApiError extends Error {
  readonly httpStatus: number;
  readonly problem: SatelitniProblemJson;
  readonly rateLimit?: { limit?: string; remaining?: string; reset?: string };

  constructor(
    httpStatus: number,
    problem: SatelitniProblemJson,
    rateLimit?: SatelitniApiError["rateLimit"]
  ) {
    super(userMessageFromProblem(httpStatus, problem));
    this.name = "SatelitniApiError";
    this.httpStatus = httpStatus;
    this.problem = problem;
    this.rateLimit = rateLimit;
  }
}
