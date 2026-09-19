import { NextResponse } from "next/server";

export type EmailApiErrorBody = {
  success: boolean;
  ok: boolean;
  error?: string;
  errorCode?: string;
  message?: string;
};

export function emailJsonOk<T extends Record<string, unknown>>(
  data: T,
  status = 200
): NextResponse {
  return NextResponse.json({ success: true, ok: true, ...data }, { status });
}

export function emailJsonErr(
  opts: {
    status: number;
    errorCode?: string;
    message: string;
    error?: string;
    extra?: Record<string, unknown>;
  }
): NextResponse {
  const { status, errorCode, message, error, extra } = opts;
  return NextResponse.json(
    {
      success: false,
      ok: false,
      error: error ?? message,
      errorCode: errorCode ?? "REQUEST_FAILED",
      message,
      ...extra,
    },
    { status }
  );
}

export function emailRouteErrorResponse(err: unknown, fallbackMessage: string): NextResponse {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("EMAIL_CREDENTIALS_ENCRYPTION_KEY")) {
    return emailJsonErr({
      status: 503,
      errorCode: "EMAIL_ENCRYPTION_NOT_CONFIGURED",
      message:
        "Server nemá nastaven šifrovací klíč pro e-mailové účty (EMAIL_CREDENTIALS_ENCRYPTION_KEY).",
    });
  }
  if (raw.includes("FAILED_PRECONDITION") || raw.includes("requires an index")) {
    return emailJsonErr({
      status: 503,
      errorCode: "FIRESTORE_INDEX",
      message: "Databáze vyžaduje index pro e-mail. Kontaktujte správce nebo nasaďte firestore.indexes.json.",
    });
  }
  return emailJsonErr({
    status: 500,
    errorCode: "INTERNAL_ERROR",
    message: fallbackMessage,
    error: raw.slice(0, 300),
  });
}
