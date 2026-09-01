/**
 * Mapování chyb AI endpointu na srozumitelné české zprávy (client-safe).
 */

export function mapInquiryAiUserErrorMessage(
  httpStatus: number,
  serverError?: string | null
): string {
  const msg = String(serverError ?? "").trim();

  if (
    msg.includes("OPENAI_API_KEY") ||
    msg.includes("nakonfigurován") ||
    msg.includes("nakonfigurována") ||
    msg.includes("nakonfigurováno")
  ) {
    return "OpenAI API není nakonfigurováno.";
  }
  if (msg.includes("Poptávka nebyla nalezena") || msg.includes("dostatek dat")) {
    return "Poptávka neobsahuje potřebná data pro AI návrh.";
  }
  if (httpStatus === 429 || msg.includes("limit požadavků")) {
    return "Byl překročen limit OpenAI API. Zkuste to později.";
  }
  if (httpStatus === 504 || msg.includes("příliš dlouho")) {
    return "AI odpověď trvala příliš dlouho. Zkuste to znovu.";
  }
  if (httpStatus === 400 || msg.includes("odmítla")) {
    return "AI služba odmítla požadavek.";
  }
  if (msg.includes("Neautorizováno") || httpStatus === 401) {
    return "Nejste přihlášeni. Obnovte stránku a zkuste znovu.";
  }
  if (httpStatus === 403) {
    return "Nemáte oprávnění používat AI asistenta.";
  }
  if (msg.includes("Chybí companyId") || msg.includes("leadKey")) {
    return "Chybí identifikace poptávky. Obnovte stránku a zkuste znovu.";
  }
  if (msg) return msg;
  return "Generování AI návrhu se nezdařilo. Zkuste to znovu.";
}
