import { NextResponse } from "next/server";
import { Resend } from "resend";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export const runtime = "nodejs";

const LOG = "[api/auth/reset-password]";

/** Bezpečná zpráva pro klienta u 500 (bez vnitřních detailů). */
const CLIENT_500 =
  "Reset hesla se nepodařilo odeslat. Zkuste to prosím později nebo kontaktujte podporu.";

function collectMissingRequiredEnv(): string[] {
  const missing: string[] = [];
  if (!String(process.env.RESEND_API_KEY ?? "").trim()) {
    missing.push("RESEND_API_KEY");
  }
  if (!String(process.env.EMAIL_FROM ?? "").trim()) {
    missing.push("EMAIL_FROM");
  }
  if (!String(process.env.APP_URL ?? "").trim()) {
    missing.push("APP_URL");
  }
  if (!String(process.env.FIREBASE_CLIENT_EMAIL ?? "").trim()) {
    missing.push("FIREBASE_CLIENT_EMAIL");
  }
  if (!String(process.env.FIREBASE_PRIVATE_KEY ?? "").trim()) {
    missing.push("FIREBASE_PRIVATE_KEY");
  }
  const projectId =
    String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "").trim() ||
    String(process.env.FIREBASE_PROJECT_ID ?? "").trim();
  if (!projectId) {
    missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID (nebo FIREBASE_PROJECT_ID)");
  }
  return missing;
}

function normalizeAppUrl(): string {
  return String(process.env.APP_URL ?? "")
    .trim()
    .replace(/\/$/, "");
}

function ensureFirebaseAdminInitialized(): void {
  if (getApps().length > 0) {
    console.log(LOG, "firebase admin: app already exists, skip init");
    return;
  }

  const projectId =
    String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "").trim() ||
    String(process.env.FIREBASE_PROJECT_ID ?? "").trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL ?? "").trim();
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;
  const privateKey = String(rawKey ?? "").replace(/\\n/g, "\n");

  console.log(LOG, "firebase admin: initializing", {
    projectIdPresent: Boolean(projectId),
    clientEmailPresent: Boolean(clientEmail),
    privateKeyPresent: Boolean(rawKey),
    privateKeyLength: rawKey?.length ?? 0,
  });

  initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
  console.log(LOG, "firebase admin: initializeApp succeeded");
}

export async function POST(req: Request) {
  console.log(LOG, "route entered");

  try {
    const missing = collectMissingRequiredEnv();
    if (missing.length > 0) {
      console.error(LOG, "env validation failed — missing:", missing);
      return NextResponse.json(
        { success: false, error: CLIENT_500 },
        { status: 500 }
      );
    }

    const appUrl = normalizeAppUrl();
    const resendKey = String(process.env.RESEND_API_KEY).trim();
    const emailFrom = String(process.env.EMAIL_FROM).trim();

    console.log(LOG, "env OK", {
      hasResendApiKey: true,
      emailFrom,
      appUrl,
      hasFirebaseClientEmail: true,
      hasFirebasePrivateKey: true,
      projectIdSource: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()
        ? "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
        : "FIREBASE_PROJECT_ID",
    });

    let body: { email?: unknown };
    try {
      body = (await req.json()) as { email?: unknown };
      console.log(LOG, "request body parsed");
    } catch (parseErr) {
      console.error(LOG, "JSON parse failed", parseErr);
      return NextResponse.json(
        { success: false, error: CLIENT_500 },
        { status: 500 }
      );
    }

    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    console.log(LOG, "email received", { hasEmail: Boolean(email), length: email.length });

    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }

    try {
      ensureFirebaseAdminInitialized();
    } catch (adminErr) {
      console.error(LOG, "Firebase Admin init FAILED (full error):", adminErr);
      if (adminErr instanceof Error) {
        console.error(LOG, "stack:", adminErr.stack);
      }
      return NextResponse.json(
        { success: false, error: CLIENT_500 },
        { status: 500 }
      );
    }

    if (!getApps().length) {
      console.error(LOG, "Firebase Admin: getApps().length still 0 after init attempt");
      return NextResponse.json(
        { success: false, error: CLIENT_500 },
        { status: 500 }
      );
    }

    console.log(LOG, "generatePasswordResetLink: started", { continueUrl: appUrl });
    let link: string;
    try {
      link = await getAuth().generatePasswordResetLink(email, {
        url: appUrl,
      });
      console.log(LOG, "generatePasswordResetLink: success", {
        linkLength: link?.length ?? 0,
      });
    } catch (linkErr) {
      console.error(LOG, "generatePasswordResetLink FAILED (full error):", linkErr);
      if (linkErr instanceof Error) {
        console.error(LOG, "message:", linkErr.message, "stack:", linkErr.stack);
      }
      const code = (linkErr as { code?: string })?.code;
      if (code) console.error(LOG, "firebase error code:", code);
      return NextResponse.json(
        { success: false, error: CLIENT_500 },
        { status: 500 }
      );
    }

    console.log(LOG, "Resend: client creating");
    const resend = new Resend(resendKey);
    console.log(LOG, "Resend: send started", { to: email, from: emailFrom });

    const sendResult = await resend.emails.send({
      from: emailFrom,
      to: email,
      subject: "Obnova hesla",
      html: `
        <h2>Obnova hesla</h2>
        <p>Klikněte na odkaz pro nastavení nového hesla:</p>
        <a href="${link}">Obnovit heslo</a>
      `,
    });

    console.log(LOG, "Resend: raw response payload", sendResult);

    if (sendResult.error) {
      console.error(LOG, "Resend: send returned error (full):", sendResult.error);
      return NextResponse.json(
        { success: false, error: CLIENT_500 },
        { status: 500 }
      );
    }

    console.log(LOG, "Resend: send success", {
      id: sendResult.data?.id ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(LOG, "UNHANDLED catch (full error):", error);
    if (error instanceof Error) {
      console.error(LOG, "message:", error.message);
      console.error(LOG, "stack:", error.stack);
    }
    return NextResponse.json(
      { success: false, error: CLIENT_500 },
      { status: 500 }
    );
  }
}
