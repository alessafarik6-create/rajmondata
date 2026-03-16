import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getAdminFirestore } from "@/lib/firebase-admin";

const SALT_ROUNDS = 10;

/**
 * POST body: { secret, username, password }
 * Creates the first superadmin in Firestore if secret matches INIT_SUPERADMIN_SECRET
 * and no superadmin exists yet (or optional: allow when secret is set).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { secret, username, password } = body as { secret?: string; username?: string; password?: string };
    const initSecret = process.env.INIT_SUPERADMIN_SECRET;
    if (!initSecret || secret !== initSecret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!username || typeof username !== "string" || !password || typeof password !== "string") {
      return NextResponse.json(
        { error: "username a password jsou povinné." },
        { status: 400 }
      );
    }
    const trimmedUsername = username.trim().toLowerCase();
    if (trimmedUsername.length < 2 || password.length < 8) {
      return NextResponse.json(
        { error: "Uživatelské jméno min. 2 znaky, heslo min. 8 znaků." },
        { status: 400 }
      );
    }

    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json(
        { error: "Firebase Admin není nakonfigurován (FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)." },
        { status: 503 }
      );
    }

    const existing = await db.collection("superadmins").where("username", "==", trimmedUsername).limit(1).get();
    if (!existing.empty) {
      return NextResponse.json(
        { error: "Uživatel s tímto jménem již existuje." },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await db.collection("superadmins").add({
      username: trimmedUsername,
      passwordHash,
      role: "superadmin",
      active: true,
      createdAt: new Date(),
    });

    return NextResponse.json({ ok: true, message: "Superadmin vytvořen." });
  } catch (e) {
    console.error("[superadmin seed]", e);
    return NextResponse.json(
      { error: "Vytvoření účtu se nezdařilo." },
      { status: 500 }
    );
  }
}
