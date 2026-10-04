/** Mapování technických chyb na text pro UI (bez API klíčů a tokenů). */
export function mapVoiceErrorForUser(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim();
  if (!t) return "Hlasovou asistentku se nepodařilo připojit.";
  if (/invalid url.*realtime\/sessions/i.test(t)) {
    return "Hlasovou asistentku se nepodařilo připojit.";
  }
  if (/openai api není nakonfigurováno|hlasová ai není na serveru/i.test(t)) {
    return "Hlasová AI není na serveru nakonfigurována.";
  }
  if (/notallowederror|permission denied|mikrofon/i.test(t)) {
    return "Prohlížeč nemá povolený mikrofon.";
  }
  if (/notfounderror|not found/i.test(t)) {
    return "Mikrofon nebyl nalezen.";
  }
  if (/notreadable|device in use/i.test(t)) {
    return "Mikrofon používá jiná aplikace.";
  }
  if (/realtime session|nepodařilo se připojit|hlasovou/i.test(t)) {
    return t;
  }
  if (/401|403|502|invalid api|rate limit/i.test(t)) {
    return "Hlasovou asistentku se nepodařilo připojit.";
  }
  return "Hlasovou asistentku se nepodařilo připojit.";
}
