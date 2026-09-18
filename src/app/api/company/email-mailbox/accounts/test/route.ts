import { NextRequest, NextResponse } from "next/server";
import { requireOrgEmailAdmin } from "@/lib/email-mailbox/api-auth";
import { getEmailProviderAdapter } from "@/lib/email-mailbox/adapters";
import { presetForProvider } from "@/lib/email-mailbox/provider-presets";
import type { EmailProviderKind } from "@/lib/email-mailbox/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = await requireOrgEmailAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

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
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const provider = body.provider as EmailProviderKind;
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const preset = presetForProvider(provider);
  if (!preset?.implemented) {
    return NextResponse.json({ ok: false, error: "Provider zatím není dostupný." }, { status: 400 });
  }
  if (!email || !password) {
    return NextResponse.json({ ok: false, error: "Vyplňte e-mail a heslo." }, { status: 400 });
  }

  const adapter = getEmailProviderAdapter(provider);
  if (!adapter) {
    return NextResponse.json({ ok: false, error: "Provider není implementován." }, { status: 400 });
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
    return NextResponse.json({ ok: false, error: test.message, test }, { status: 400 });
  }
  return NextResponse.json({ ok: true, test });
}
