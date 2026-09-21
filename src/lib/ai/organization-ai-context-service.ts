import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import { canAccessCompanyModule, type CompanyPlatformFields } from "@/lib/platform-access";
import { loadMergedCatalogFromFirestore } from "@/lib/platform-invoice-auto";
import {
  canAccessPortalModule,
  type PortalModuleId,
  type PortalAccessLevel,
} from "@/lib/portal-permissions";
import {
  loadEmployeeDocForCaller,
  resolveCallerPortalPermissions,
} from "@/lib/portal-permissions-server";
import { resolveCameraPermissions } from "@/lib/hikvision/camera-access";
import {
  calendarDaysUntilJobDeadline,
  isJobOpenForDeadlineWidget,
  selectUpcomingDeadlineJobs,
} from "@/lib/dashboard-deadline-jobs";
import {
  computeDashboardEmailStats,
  emailMessagesCol,
} from "@/lib/email-mailbox/message-store";
import {
  loadAccessibleAccountIdSet,
  messageBelongsToUser,
} from "@/lib/email-mailbox/account-access";
import type { EmailMessageDoc } from "@/lib/email-mailbox/types";
import { listHikvisionCameras } from "@/lib/hikvision/stores";
import type { OrganizationAiContextSnapshot } from "@/lib/ai/organization-ai-types";

const briefingCache = new Map<string, { expires: number; data: OrganizationAiContextSnapshot }>();
const BRIEFING_CACHE_MS = 3 * 60 * 1000;

function cacheKey(orgId: string, uid: string): string {
  return `${orgId}:${uid}`;
}

function portalLevel(
  perms: ReturnType<typeof resolveCallerPortalPermissions> extends Promise<infer T> ? T : never,
  id: PortalModuleId
): PortalAccessLevel {
  return perms[id] ?? "none";
}

function moduleActive(
  company: CompanyPlatformFields,
  catalog: Awaited<ReturnType<typeof loadMergedCatalogFromFirestore>>,
  code: string
): boolean {
  return canAccessCompanyModule(company, code as Parameters<typeof canAccessCompanyModule>[1], catalog);
}

export class OrganizationAiContextService {
  constructor(
    private readonly db: Firestore,
    private readonly organizationId: string,
    private readonly caller: VerifiedCompanyCaller,
    private readonly company: CompanyPlatformFields
  ) {}

  async buildContext(opts?: { useCache?: boolean }): Promise<OrganizationAiContextSnapshot> {
    const key = cacheKey(this.organizationId, this.caller.uid);
    if (opts?.useCache !== false) {
      const hit = briefingCache.get(key);
      if (hit && hit.expires > Date.now()) return hit.data;
    }

    const [catalog, portalPerms, employeeDoc, userSnap] = await Promise.all([
      loadMergedCatalogFromFirestore(this.db),
      resolveCallerPortalPermissions(this.db, this.caller),
      loadEmployeeDocForCaller(this.db, this.caller),
      this.db.collection("users").doc(this.caller.uid).get(),
    ]);

    const userData = userSnap.data() as { displayName?: string; email?: string } | undefined;
    const displayName =
      String(userData?.displayName ?? "").trim() ||
      String(userData?.email ?? "").split("@")[0] ||
      "kolego";

    const cameraPerms = resolveCameraPermissions({
      role: this.caller.role,
      globalRoles: this.caller.globalRoles,
      employeeDoc,
      portalModuleCamerasLevel: portalPerms.cameras ?? "none",
    });

    const permissions: Record<string, PortalAccessLevel> = {};
    for (const id of Object.keys(portalPerms) as PortalModuleId[]) {
      permissions[id] = portalPerms[id] ?? "none";
    }

    const modulesEnabled: Record<string, boolean> = {
      jobs: moduleActive(this.company, catalog, "jobs"),
      emails: moduleActive(this.company, catalog, "emails"),
      invoicing: moduleActive(this.company, catalog, "invoicing"),
      cameras: moduleActive(this.company, catalog, "cameras"),
      sklad: moduleActive(this.company, catalog, "sklad"),
      vyroba: moduleActive(this.company, catalog, "vyroba"),
      attendance_payroll: moduleActive(this.company, catalog, "attendance_payroll"),
    };

    const snapshot: OrganizationAiContextSnapshot = {
      generatedAt: new Date().toISOString(),
      organizationId: this.organizationId,
      user: { displayName, role: this.caller.role },
      modulesEnabled,
      permissions,
    };

    const tasks: Promise<void>[] = [];

    if (
      modulesEnabled.emails &&
      canAccessPortalModule(portalPerms, "emails", "read")
    ) {
      tasks.push(
        (async () => {
          const accessibleIds = await loadAccessibleAccountIdSet(
            this.db,
            this.organizationId,
            this.caller.uid
          );
          if (accessibleIds.size === 0) {
            snapshot.emails = { waitingForReply: 0, overdue: 0, urgent: 0, samples: [] };
            return;
          }
          const snap = await emailMessagesCol(this.db, this.organizationId)
            .orderBy("receivedAt", "desc")
            .limit(120)
            .get();
          const rows = snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as EmailMessageDoc) }))
            .filter((m) => messageBelongsToUser(m, this.caller.uid, accessibleIds));
          const dash = computeDashboardEmailStats(rows, this.caller.uid);
          const samples = rows
            .filter((m) => m.needsReply && !m.resolved && m.direction === "inbound")
            .slice(0, 3)
            .map((m) => ({
              id: m.id,
              subject: String(m.subject ?? "E-mail").slice(0, 120),
            }));
          snapshot.emails = {
            waitingForReply: dash.waitingReply,
            overdue: dash.overdue,
            urgent: dash.urgent,
            samples,
          };
        })()
      );
    }

    if (modulesEnabled.jobs && canAccessPortalModule(portalPerms, "jobs", "read")) {
      tasks.push(
        (async () => {
          const snap = await this.db
            .collection("companies")
            .doc(this.organizationId)
            .collection("jobs")
            .limit(400)
            .get();
          const jobs = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as { name?: string; status?: string; endDate?: string }),
          }));
          const open = jobs.filter(isJobOpenForDeadlineWidget);
          const overdueRows = selectUpcomingDeadlineJobs(open, { now: new Date() }).filter(
            (j) => j.urgency === "overdue"
          );
          snapshot.jobs = {
            active: open.length,
            overdue: overdueRows.length,
            overdueSamples: overdueRows.slice(0, 5).map((j) => ({
              id: j.id,
              name: String(j.name ?? j.id),
              daysOverdue: Math.abs(
                calendarDaysUntilJobDeadline(String(j.endDate ?? ""), new Date()) ?? 0
              ),
            })),
          };
        })()
      );
    }

    if (canAccessPortalModule(portalPerms, "documents", "read")) {
      tasks.push(
        (async () => {
          const snap = await this.db
            .collection("companies")
            .doc(this.organizationId)
            .collection("documents")
            .where("assignmentType", "==", "pending_assignment")
            .limit(50)
            .get();
          snapshot.documents = { pendingClassification: snap.size };
        })()
      );
    }

    const financeRead =
      canAccessPortalModule(portalPerms, "finance", "read") ||
      canAccessPortalModule(portalPerms, "invoices", "read");
    if (financeRead && modulesEnabled.invoicing) {
      tasks.push(
        (async () => {
          const snap = await this.db
            .collection("companies")
            .doc(this.organizationId)
            .collection("finance")
            .limit(200)
            .get();
          let unpaid = 0;
          let overdue = 0;
          const overdueSamples: Array<{ id: string; label: string }> = [];
          const today = new Date().toISOString().slice(0, 10);
          for (const doc of snap.docs) {
            const d = doc.data() as {
              status?: string;
              paymentStatus?: string;
              dueDate?: string;
              invoiceNumber?: string;
            };
            const st = String(d.paymentStatus ?? d.status ?? "").toLowerCase();
            if (st === "paid") continue;
            unpaid += 1;
            const due = String(d.dueDate ?? "").slice(0, 10);
            if (due && due < today) {
              overdue += 1;
              if (overdueSamples.length < 5) {
                overdueSamples.push({
                  id: doc.id,
                  label: String(d.invoiceNumber ?? doc.id),
                });
              }
            }
          }
          snapshot.finance = { unpaidInvoices: unpaid, overdueInvoices: overdue, overdueSamples };
        })()
      );
    }

    if (canAccessPortalModule(portalPerms, "schedule", "read")) {
      tasks.push(
        (async () => {
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          const end = new Date(start);
          end.setHours(23, 59, 59, 999);
          const snap = await this.db
            .collection("companies")
            .doc(this.organizationId)
            .collection("lead_meetings")
            .where("scheduledAt", ">=", start)
            .where("scheduledAt", "<=", end)
            .limit(20)
            .get()
            .catch(() => null);
          snapshot.calendar = {
            todayMeetings: snap?.size ?? 0,
            todayInstallations: 0,
            nextEventLabel: snap?.docs[0]
              ? String((snap.docs[0].data() as { title?: string }).title ?? "")
              : undefined,
          };
        })()
      );
    }

    if (modulesEnabled.vyroba && canAccessPortalModule(portalPerms, "vyroba", "read")) {
      tasks.push(
        (async () => {
          const snap = await this.db
            .collection("companies")
            .doc(this.organizationId)
            .collection("production")
            .limit(100)
            .get();
          let waiting = 0;
          for (const doc of snap.docs) {
            const st = String((doc.data() as { status?: string }).status ?? "");
            if (st === "waiting" || st === "queued") waiting += 1;
          }
          snapshot.production = { waiting };
        })()
      );
    }

    if (modulesEnabled.cameras && cameraPerms.view && portalLevel(portalPerms, "cameras") !== "none") {
      tasks.push(
        (async () => {
          const cameras = await listHikvisionCameras(this.db, this.organizationId);
          snapshot.cameras = {
            total: cameras.length,
            online: cameras.filter((c) => c.online).length,
            offline: cameras.filter((c) => !c.online).length,
          };
        })()
      );
    }

    if (canAccessPortalModule(portalPerms, "labor", "read")) {
      tasks.push(
        (async () => {
          const today = new Date().toISOString().slice(0, 10);
          const snap = await this.db
            .collection("companies")
            .doc(this.organizationId)
            .collection("attendance")
            .where("date", "==", today)
            .limit(200)
            .get()
            .catch(() => null);
          snapshot.attendance = {
            workingToday: snap?.size ?? 0,
          };
        })()
      );
    }

    await Promise.all(tasks.map((t) => t.catch(() => undefined)));

    briefingCache.set(key, { expires: Date.now() + BRIEFING_CACHE_MS, data: snapshot });
    return snapshot;
  }
}
