import type { Firestore } from "firebase-admin/firestore";
import { loadTodayAttendanceEventsByEmployee } from "@/lib/attendance-day-server";
import {
  isShiftOpenFromSorted,
  type AttendanceEventLite,
} from "@/lib/attendance-shift-state";
import { findOpenWorkSegment } from "@/lib/work-segment-server";

export type ProductionAttendanceStatus =
  | "WORKING"
  | "NOT_CLOCKED_IN"
  | "ON_BREAK"
  | "NON_WORKING_TARIFF"
  | "CLOCKED_OUT";

export type ProductionAttendanceEligibility = {
  status: ProductionAttendanceStatus;
  canStartProduction: boolean;
  userMessage: string;
};

function isOnExplicitBreak(sorted: AttendanceEventLite[]): boolean {
  for (let i = sorted.length - 1; i >= 0; i--) {
    const ty = sorted[i]!.type;
    if (ty === "check_out") return false;
    if (ty === "break_end") return false;
    if (ty === "break_start") return true;
  }
  return false;
}

/** Čistá logika pro testy — bez Firestore. */
export function evaluateProductionAttendanceEligibility(input: {
  attendanceEvents: AttendanceEventLite[];
  openSegmentSourceType: "job" | "tariff" | null;
}): ProductionAttendanceEligibility {
  const sorted = input.attendanceEvents;
  const shiftOpen = isShiftOpenFromSorted(sorted);

  if (!shiftOpen) {
    const hadCheckOut = sorted.some((e) => e.type === "check_out");
    return {
      status: hadCheckOut || sorted.length > 0 ? "CLOCKED_OUT" : "NOT_CLOCKED_IN",
      canStartProduction: false,
      userMessage:
        "Nejste přihlášen/a v práci. Nejprve se přihlaste na hlavním docházkovém terminálu.",
    };
  }

  if (isOnExplicitBreak(sorted)) {
    return {
      status: "ON_BREAK",
      canStartProduction: false,
      userMessage:
        "Právě máte přestávku. QR výrobní úkol lze spustit až po návratu do práce na hlavním terminálu.",
    };
  }

  if (input.openSegmentSourceType === "tariff") {
    return {
      status: "NON_WORKING_TARIFF",
      canStartProduction: false,
      userMessage:
        "Nejste v pracovním režimu (oběd / tarif). QR výrobní úkol lze spustit až po návratu k práci na hlavním terminálu.",
    };
  }

  return {
    status: "WORKING",
    canStartProduction: true,
    userMessage: "",
  };
}

export async function resolveEmployeeProductionAttendanceEligibility(
  db: Firestore,
  companyId: string,
  employeeId: string,
  dateIso: string
): Promise<ProductionAttendanceEligibility> {
  const byEmp = await loadTodayAttendanceEventsByEmployee(db, companyId, dateIso);
  const events = byEmp.get(employeeId) ?? [];

  let openSegmentSourceType: "job" | "tariff" | null = null;
  const openSeg = await findOpenWorkSegment(db, companyId, employeeId, dateIso);
  if (openSeg) {
    const st = String((openSeg.data() as { sourceType?: string }).sourceType ?? "");
    if (st === "tariff") openSegmentSourceType = "tariff";
    else if (st === "job") openSegmentSourceType = "job";
  }

  return evaluateProductionAttendanceEligibility({
    attendanceEvents: events,
    openSegmentSourceType,
  });
}

export function productionEndReasonForTariffMeta(tariff: {
  name?: string | null;
  category?: string | null;
}): "attendance_lunch" | "attendance_break" {
  const name = String(tariff.name ?? "").toLowerCase();
  const cat = String(tariff.category ?? "").toLowerCase();
  if (
    name.includes("oběd") ||
    name.includes("obed") ||
    name.includes("lunch") ||
    cat.includes("oběd") ||
    cat.includes("obed") ||
    cat === "lunch"
  ) {
    return "attendance_lunch";
  }
  return "attendance_break";
}
