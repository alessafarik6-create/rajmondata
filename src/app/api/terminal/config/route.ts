import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getCompanyDisplayName, resolveTerminalCompanyId } from "@/lib/terminal-company-resolve";

/**
 * Veřejná konfigurace terminálu — bez Firebase Auth.
 * Auto auth creation disabled — žádný kiosk účet.
 */
export async function GET() {
  if (process.env.NODE_ENV === "development") {
    console.log("[terminal/config] Terminal uses PIN session only (no Firebase Auth user)");
  }
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }
  try {
    const companyId = await resolveTerminalCompanyId();
    if (!companyId) {
      return NextResponse.json(
        {
          error:
            "Terminál není nakonfigurován. Vytvořte aktivní záznam v kolekci terminálOdkazy (aktivní = true, pole ID společnosti), případně nastavte TERMINAL_COMPANY_ID nebo config/terminal.",
        },
        { status: 503 }
      );
    }
    const companyName = await getCompanyDisplayName(companyId);
    return NextResponse.json({ companyId, companyName });
  } catch (e) {
    console.error("[terminal/config]", e);
    return NextResponse.json({ error: "Konfiguraci terminálu se nepodařilo načíst." }, { status: 500 });
  }
}
