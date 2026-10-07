import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore, getAdminAuth } from "@/lib/firebase-admin";
import { passwordPolicyError } from "@/lib/employee-password-policy";

export const runtime = "nodejs";

type Body = {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
};

async function verifyCurrentPassword(email: string, password: string): Promise<boolean> {
  const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "").trim();
  if (!apiKey) return false;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  return res.ok;
}

export async function POST(request: NextRequest) {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) {
    return NextResponse.json({ error: "Server není k dispozici." }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!idToken) {
    return NextResponse.json({ error: "Chybí přihlášení." }, { status: 401 });
  }

  let decoded: { uid: string; email?: string };
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "Neplatná session." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON." }, { status: 400 });
  }

  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  const confirmPassword = String(body.confirmPassword ?? "");

  if (!currentPassword) {
    return NextResponse.json({ error: "Vyplňte současné heslo." }, { status: 400 });
  }
  const policyErr = passwordPolicyError(newPassword);
  if (policyErr) {
    return NextResponse.json({ error: policyErr }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: "Nová hesla se neshodují." }, { status: 400 });
  }
  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: "Nové heslo musí být odlišné od současného." },
      { status: 400 }
    );
  }

  let email = decoded.email?.trim() ?? "";
  if (!email) {
    const userRecord = await auth.getUser(decoded.uid);
    email = userRecord.email?.trim() ?? "";
  }
  if (!email) {
    return NextResponse.json({ error: "Účet nemá e-mail pro ověření hesla." }, { status: 400 });
  }

  const currentOk = await verifyCurrentPassword(email, currentPassword);
  if (!currentOk) {
    return NextResponse.json({ error: "Současné heslo není správné." }, { status: 403 });
  }

  try {
    await auth.updateUser(decoded.uid, { password: newPassword });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "auth/weak-password") {
      return NextResponse.json(
        { error: "Nové heslo je příliš slabé. Zvolte delší nebo složitější heslo." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Změna hesla se nezdařila." }, { status: 500 });
  }
}
