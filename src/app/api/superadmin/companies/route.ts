import { NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getCompany } from "@/lib/superadmin-companies";

export async function GET() {
  const session = await getSessionFromCookie();
if (!session) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json(
      {
        error:
          "Firebase Admin není nakonfigurován. Nastavte FIREBASE_CLIENT_EMAIL a FIREBASE_PRIVATE_KEY v .env.local.",
      },
      { status: 503 }
    );
  }

  try {
    const companies = await getCompany(db);
    return NextResponse.json(companies);
  } catch (e) {
    console.error("[superadmin companies]", e);
    return NextResponse.json(
      { error: "Nepodařilo se načíst firmy." },
      { status: 500 }
    );
  }
}