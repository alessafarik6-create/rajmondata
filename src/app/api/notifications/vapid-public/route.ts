import { NextResponse } from "next/server";
import { getVapidPublicKey } from "@/lib/notification-service/notification-service";

/**
 * Veřejný VAPID klíč pro PushManager.subscribe (jen veřejná část).
 */
export async function GET() {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return NextResponse.json(
      {
        configured: false,
        error:
          "Web Push není nakonfigurován. Nastavte VAPID_PUBLIC_KEY a VAPID_PRIVATE_KEY (nebo NEXT_PUBLIC_VAPID_PUBLIC_KEY) na serveru.",
      },
      { status: 503 }
    );
  }
  return NextResponse.json({ configured: true, publicKey });
}
