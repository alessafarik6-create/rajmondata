import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { generatePortalAnalyticsAlerts } from "@/lib/portal-analytics/alerts-generator";

function cronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Admin unavailable" }, { status: 503 });

  const created = await generatePortalAnalyticsAlerts(db);
  return NextResponse.json({ ok: true, alertsCreated: created });
}
