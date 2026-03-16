import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createSession, setSessionCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body as { username?: string; password?: string };
    if (!username || typeof username !== "string" || !password || typeof password !== "string") {
      return NextResponse.json(
        { error: "Uživatelské jméno a heslo jsou povinné." },
        { status: 400 }
      );
    }

    const trimmedUsername = username.trim().toLowerCase();
    if (!trimmedUsername || !password) {
      return NextResponse.json(
        { error: "Uživatelské jméno a heslo jsou povinné." },
        { status: 400 }
      );
    }

    // 1) Check env-based superadmin (first account)
    const envUser = process.env.SUPERADMIN_USERNAME?.trim().toLowerCase();
    const envHash = process.env.SUPERADMIN_PASSWORD_HASH;
    if (envUser && envHash && trimmedUsername === envUser) {
      const match = await bcrypt.compare(password, envHash);
      if (match) {
        const token = await createSession({ username: envUser, role: "superadmin" });
        await setSessionCookie(token);
        return NextResponse.json({ ok: true, username: envUser });
      }
    }

    // 2) Check Firestore superadmins collection
    const db = getAdminFirestore();
    if (db) {
      const snapshot = await db.collection("superadmins").where("username", "==", trimmedUsername).limit(1).get();
      const doc = snapshot.docs[0];
      if (doc?.exists) {
        const data = doc.data();
        if (data.active === false) {
          return NextResponse.json({ error: "Účet je deaktivován." }, { status: 403 });
        }
        const passwordHash = data.passwordHash as string;
        if (passwordHash && (await bcrypt.compare(password, passwordHash))) {
          const token = await createSession({ username: trimmedUsername, role: data.role || "superadmin" });
          await setSessionCookie(token);
          return NextResponse.json({ ok: true, username: trimmedUsername });
        }
      }
    }

    // 3) Development-only fallback: default admin/admin123 when no env and no Firestore doc
    const defaultAdminHash =
      "$2b$10$xMMZXlP.El8maWLEUNC/MuJ0VxcWZi6js5BqfrljD6nZ5UWSCXRMi";
    if (
      process.env.NODE_ENV === "development" &&
      trimmedUsername === "admin" &&
      (await bcrypt.compare(password, defaultAdminHash))
    ) {
      const token = await createSession({ username: "admin", role: "superadmin" });
      await setSessionCookie(token);
      return NextResponse.json({ ok: true, username: "admin" });
    }

    return NextResponse.json(
      { error: "Neplatné uživatelské jméno nebo heslo." },
      { status: 401 }
    );
  } catch (e) {
    console.error("[superadmin login]", e);
    return NextResponse.json(
      { error: "Přihlášení se nezdařilo." },
      { status: 500 }
    );
  }
}
