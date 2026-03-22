import { NextResponse } from "next/server";
import { loadPublicTerminalConfig } from "@/lib/terminal-config-server";

/**
 * Veřejná konfigurace terminálu — bez Firebase Auth, bez session.
 * Čte terminálOdkazy + společnosti (viz loadPublicTerminalConfig).
 */
export async function GET() {
  try {
    const result = await loadPublicTerminalConfig();

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      companyId: result.companyId,
      companyName: result.companyName,
      terminalConfig: result.terminalConfig,
    });
  } catch (error) {
    console.error("Terminal config error", error);
    return NextResponse.json(
      { success: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
