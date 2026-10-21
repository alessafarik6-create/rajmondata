import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { AiOrgMilestoneId } from "@/lib/ai-tutor/types";

async function countSub(db: Firestore, companyId: string, sub: string, limit = 1): Promise<number> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(sub)
    .limit(limit)
    .get();
  return snap.size;
}

/** Milníky z reálných dat organizace (ne z kliknutí v průvodci). */
export async function computeOrganizationMilestones(
  db: Firestore,
  companyId: string
): Promise<Record<AiOrgMilestoneId, boolean>> {
  const companyRef = db.collection(COMPANIES_COLLECTION).doc(companyId);
  const [jobs, customers, employees, invoices, offers] = await Promise.all([
    countSub(db, companyId, "jobs"),
    countSub(db, companyId, "customers"),
    countSub(db, companyId, "employees"),
    countSub(db, companyId, "invoices"),
    countSub(db, companyId, "importLeads", 1).catch(() => 0),
  ]);

  const integrationSnap = await companyRef.collection("fleet_integration").doc("fleet_integration").get();
  const fleetData = integrationSnap.data() as { status?: string; provider?: string } | undefined;
  const gpsConnected =
    fleetData?.status === "connected" && fleetData?.provider === "SATELITNI_SLEDOVANI";

  const emailSnap = await companyRef.collection("email_accounts").limit(1).get();
  const emailConnected = !emailSnap.empty;

  let hasContract = false;
  const jobsForContract = await companyRef.collection("jobs").limit(8).get();
  for (const j of jobsForContract.docs) {
    const wc = await j.ref.collection("workContracts").limit(1).get();
    if (!wc.empty) {
      hasContract = true;
      break;
    }
  }

  const attendanceSnap = await companyRef.collection("attendanceDevices").limit(1).get().catch(() => null);
  const attendanceConfigured = Boolean(attendanceSnap && !attendanceSnap.empty);

  const warehouseSnap = await companyRef.collection("warehouseProducts").limit(1).get().catch(() => null);
  const warehouseItem = Boolean(warehouseSnap && !warehouseSnap.empty);

  return {
    first_job_created: jobs > 0,
    first_customer_created: customers > 0,
    first_employee_created: employees > 0,
    first_invoice_created: invoices > 0,
    first_offer_created: offers > 0,
    email_connected: emailConnected,
    first_contract_created: hasContract,
    attendance_configured: attendanceConfigured,
    warehouse_item_created: warehouseItem,
    gps_connected: gpsConnected,
  };
}
