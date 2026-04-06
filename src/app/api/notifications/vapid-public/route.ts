import { NextResponse } from "next/server";

/**
 * Veřejný VAPID klíč pro PushManager.subscribe (jen veřejná část).
 */
export async function GET() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (!publicKey) {
    return NextResponse.json(
      { error: "Web Push není nakonfigurován (NEXT_PUBLIC_VAPID_PUBLIC_KEY)." },
      { status: 503 }
    );
  }
  return NextResponse.json({ publicKey });
}
