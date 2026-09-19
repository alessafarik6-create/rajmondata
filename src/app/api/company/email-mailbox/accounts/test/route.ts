import { NextRequest } from "next/server";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import { emailJsonErr, emailJsonOk, emailRouteErrorResponse } from "@/lib/email-mailbox/api-json";
import { presetForProvider } from "@/lib/email-mailbox/provider-presets";
import type { EmailProviderKind } from "@/lib/email-mailbox/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireEmailMailboxWrite(request);
    if (!auth.ok) {
      return emailJsonErr({
        status: auth.status,
        message: auth.error,
        error: auth.error,
        errorCode: auth.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
      });
    }

    let body: {
      provider?: EmailProviderKind;
      email?: string;
      password?: string;
      username?: string;
      imapHost?: string;
      imapPort?: number;
      imapSecure?: boolean;
      smtpHost?: string;
      smtpPort?: number;
      smtpSecure?: boolean;
    };
    try {
      body = await request.json();
    } catch {
      return emailJsonErr({ status: 400, message: "Neplatné tělo.", errorCode: "BAD_JSON" });
    }

    const provider = body.provider as EmailProviderKind;
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const preset = presetForProvider(provider);
    if (!preset?.implemented) {
      return emailJsonErr({
        status: 400,
        message: "Provider zatím není dostupný.",
        errorCode: "PROVIDER_UNAVAILABLE",
      });
    }
    if (!email || !password) {
      return emailJsonErr({
        status: 400,
        message: "Vyplňte e-mail a heslo.",
        errorCode: "VALIDATION",
      });
    }

    const { getEmailProviderAdapter } = await import("@/lib/email-mailbox/adapters");
    const adapter = getEmailProviderAdapter(provider);
    if (!adapter) {
      return emailJsonErr({
        status: 400,
        message: "Provider není implementován.",
        errorCode: "PROVIDER_UNAVAILABLE",
      });
    }

    const account = {
      email,
      imapHost: body.imapHost?.trim() || preset.imapHost,
      imapPort: Number(body.imapPort ?? preset.imapPort),
      imapSecure: body.imapSecure ?? preset.imapSecure,
      smtpHost: body.smtpHost?.trim() || preset.smtpHost,
      smtpPort: Number(body.smtpPort ?? preset.smtpPort),
      smtpSecure: body.smtpSecure ?? preset.smtpSecure,
    };

    const username = String(body.username ?? email).trim();
    const test = await adapter.testConnection(account, { username, password });
    if (!test.ok) {
      return emailJsonErr({
        status: 400,
        message: test.message ?? "Test připojení selhal.",
        errorCode: test.errorCode ?? "CONNECT_TEST_FAILED",
        extra: { test },
      });
    }
    return emailJsonOk({
      test,
      message: "✓ IMAP připojení úspěšné. ✓ SMTP připojení úspěšné.",
    });
  } catch (err) {
    console.error("[email-mailbox/accounts/test]", err instanceof Error ? err.message : err);
    return emailRouteErrorResponse(err, "Test připojení selhal kvůli chybě serveru.");
  }
}
