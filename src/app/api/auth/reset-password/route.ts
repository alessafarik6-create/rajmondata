import { NextResponse } from "next/server";
import { Resend } from "resend";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export const runtime = "nodejs";

const resend = new Resend(process.env.RESEND_API_KEY);

// Firebase Admin init (sdílený stav s ostatními voláními firebase-admin v procesu)
if (!getApps().length) {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    "";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }
}

function resetContinueUrl(): string {
  const raw = process.env.APP_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: unknown };
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }

    const url = resetContinueUrl();
    if (!url) {
      console.error("RESET ERROR: APP_URL (or VERCEL_URL) missing for generatePasswordResetLink");
      return NextResponse.json({ success: true });
    }

    if (!getApps().length) {
      console.error("RESET ERROR: Firebase Admin app not initialized (check FIREBASE_* env)");
      return NextResponse.json({ success: true });
    }

    // Vygenerování reset linku
    const link = await getAuth().generatePasswordResetLink(email, {
      url,
    });

    // Odeslání e-mailu přes Resend
    const { error: resendError } = await resend.emails.send({
      from:
        process.env.EMAIL_FROM?.trim() || "Rajmondata <noreply@rajmondata.cz>",
      to: email,
      subject: "Obnova hesla",
      html: `
        <h2>Obnova hesla</h2>
        <p>Klikněte na odkaz pro nastavení nového hesla:</p>
        <a href="${link}">Obnovit heslo</a>
      `,
    });

    if (resendError) {
      console.error("RESET ERROR: Resend", resendError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("RESET ERROR:", error);

    // Bezpečnostní odpověď (neprozrazuje existenci účtu ani vnitřní chyby)
    return NextResponse.json({ success: true });
  }
}
