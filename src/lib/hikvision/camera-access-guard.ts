import type { Firestore } from "firebase-admin/firestore";
import { normalizeCompanyRole } from "@/lib/company-privilege";
import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import {
  callerHasCameraPermission,
  type CameraPermissionFlag,
} from "@/lib/hikvision/camera-access";
import {
  employeeCanAccessCamera,
  listEmployeeCameraAccess,
} from "@/lib/hikvision/employee-camera-access";
import type { PortalAccessLevel } from "@/lib/portal-permissions";

export function isCameraPrivilegedCaller(caller: VerifiedCompanyCaller): boolean {
  const role = normalizeCompanyRole(caller.role);
  if (role === "owner" || role === "admin" || role === "manager") return true;
  return Array.isArray(caller.globalRoles) && caller.globalRoles.includes("super_admin");
}

export async function assertCallerCameraAccess(input: {
  db: Firestore;
  organizationId: string;
  caller: VerifiedCompanyCaller;
  employeeDoc: Record<string, unknown> | null;
  cameraId: string;
  permission: CameraPermissionFlag | "control";
  portalCamerasLevel?: PortalAccessLevel;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const flag: CameraPermissionFlag =
    input.permission === "control" ? "admin" : input.permission;
  if (input.permission === "control") {
    if (
      !isCameraPrivilegedCaller(input.caller) &&
      !callerHasCameraPermission(
        input.caller,
        input.employeeDoc,
        "control",
        input.portalCamerasLevel
      )
    ) {
      return { ok: false, status: 403, error: "Nemáte oprávnění CAMERAS_CONTROL." };
    }
  } else if (
    !callerHasCameraPermission(
      input.caller,
      input.employeeDoc,
      flag,
      input.portalCamerasLevel
    )
  ) {
    return { ok: false, status: 403, error: "K modulu Kamery nemáte oprávnění." };
  }

  if (isCameraPrivilegedCaller(input.caller)) {
    return { ok: true };
  }

  const employeeId = String(input.caller.employeeId ?? input.caller.uid).trim();
  const rules = await listEmployeeCameraAccess(input.db, input.organizationId, employeeId);
  if (rules.length === 0) {
    return { ok: true };
  }

  const need =
    input.permission === "view"
      ? "view"
      : input.permission === "live"
        ? "live"
        : input.permission === "playback"
          ? "playback"
          : "control";

  if (!employeeCanAccessCamera(rules, input.cameraId, need)) {
    return { ok: false, status: 403, error: "K této kameře nemáte oprávnění." };
  }

  return { ok: true };
}
