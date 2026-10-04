const PREFIX = "[VOICE]";

export function voiceDebugLog(message: string, detail?: Record<string, string | boolean | number>) {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_VOICE_DEBUG !== "1") {
    return;
  }
  if (detail) {
    console.info(PREFIX, message, detail);
  } else {
    console.info(PREFIX, message);
  }
}

export function voiceDebugError(message: string, detail?: string) {
  console.error(PREFIX, message, detail ?? "");
}
