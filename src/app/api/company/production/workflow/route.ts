import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  isCompanyPrivileged,
  verifyCompanyBearer,
} from "@/lib/api-company-auth";
import { isCompanyEmployeeRole } from "@/lib/company-privilege";
import {
  employeeAssignedToJobProduction,
  parseJobProductionSettings,
} from "@/lib/job-production-settings";
import {
  parseProductionWorkflowStatus,
  type ProductionWorkflowStatus,
} from "@/lib/production-job-workflow";

type Body = { jobId?: string; action?: string };

export async function POST(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const { db, caller } = v;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const jobId = String(body.jobId || "").trim();
  const action = String(body.action || "").trim().toLowerCase();
  if (!jobId || !action) {
    return NextResponse.json({ error: "Chybí jobId nebo action." }, { status: 400 });
  }
  if (!["pause", "resume", "complete"].includes(action)) {
    return NextResponse.json({ error: "Neplatná akce (pause, resume, complete)." }, { status: 400 });
  }

  const jobRef = db.collection("companies").doc(caller.companyId).collection("jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    return NextResponse.json({ error: "Zakázka neexistuje." }, { status: 404 });
  }

  const data = jobSnap.data() as Record<string, unknown>;
  const settings = parseJobProductionSettings(data);
  const assigned =
    isCompanyEmployeeRole(caller.role) &&
    caller.employeeId &&
    employeeAssignedToJobProduction(settings, caller.employeeId);
  const privileged = isCompanyPrivileged(caller.role, caller.globalRoles);
  if (!assigned && !privileged) {
    return NextResponse.json({ error: "Nemáte oprávnění k výrobě této zakázky." }, { status: 403 });
  }

  const wf = parseProductionWorkflowStatus(data);
  const userSnap = await db.collection("users").doc(caller.uid).get();
  const u = userSnap.data() as Record<string, unknown> | undefined;
  const displayName =
    (typeof u?.displayName === "string" && u.displayName.trim()
      ? u.displayName.trim()
      : null) ||
    (typeof u?.email === "string" && u.email.includes("@")
      ? String(u.email).split("@")[0]
      : null) ||
    caller.uid;

  let next: ProductionWorkflowStatus | null = null;
  const patch: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (action === "pause") {
    if (wf !== "started" && wf !== "in_progress") {
      return NextResponse.json(
        { error: "Výrobu lze pozastavit jen ve stavu Zahájeno nebo Ve výrobě." },
        { status: 400 }
      );
    }
    next = "paused";
    patch.productionWorkflowStatus = next;
    patch.productionStatus = "paused";
  } else if (action === "resume") {
    if (wf !== "paused") {
      return NextResponse.json({ error: "Obnovit lze jen pozastavenou výrobu." }, { status: 400 });
    }
    next = "in_progress";
    patch.productionWorkflowStatus = next;
    patch.productionStatus = "active";
  } else if (action === "complete") {
    if (wf === "not_started" || wf === "completed") {
      return NextResponse.json(
        { error: "Dokončit nelze — výroba ještě nebyla zahájena, nebo je již dokončená." },
        { status: 400 }
      );
    }
    next = "completed";
    patch.productionWorkflowStatus = next;
    patch.productionStatus = "completed";
    patch.productionCompletedAt = FieldValue.serverTimestamp();
    patch.productionCompletedBy = caller.uid;
    patch.productionCompletedByName = displayName;
  }

  await jobRef.update(patch);
  return NextResponse.json({ ok: true, productionWorkflowStatus: next });
}
