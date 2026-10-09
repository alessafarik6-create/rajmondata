"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { usePortalPermissionsOptional } from "@/contexts/portal-permissions-context";
import { resolveEffectivePortalPermissions } from "@/lib/portal-permissions";
import {
  canManageOrganizationPayroll,
  canViewOthersPayrollData,
} from "@/lib/labor/labor-payroll-access";

const NAV = [
  {
    href: "/portal/labor/dochazka/prehled",
    label: "Přehled docházky",
    segment: "dochazka-prehled" as const,
    privilegedOnly: true as const,
    payrollAdminOnly: false as const,
  },
  {
    href: "/portal/labor/dochazka",
    label: "Docházka",
    segment: "dochazka" as const,
    privilegedOnly: false as const,
    payrollAdminOnly: false as const,
  },
  {
    href: "/portal/labor/vykazy",
    label: "Výkazy práce",
    segment: "vykazy" as const,
    privilegedOnly: false as const,
    payrollAdminOnly: false as const,
  },
  {
    href: "/portal/labor/vyplaty",
    label: "Výplaty",
    segment: "vyplaty" as const,
    privilegedOnly: false as const,
    payrollAdminOnly: false as const,
  },
  {
    href: "/portal/labor/tarify",
    label: "Tarify",
    segment: "tarify" as const,
    privilegedOnly: false as const,
    payrollAdminOnly: true as const,
  },
];

export function LaborNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const isApprovalsTab = tab === "approvals";

  const { user } = useUser();
  const firestore = useFirestore();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc(userRef);
  const role = profile?.role ?? "employee";
  const ownEmployeeId = String(profile?.employeeId ?? "").trim() || null;

  const portalPerms = usePortalPermissionsOptional();
  const payrollCtx = useMemo(
    () => ({
      role,
      employeeId: ownEmployeeId,
      permissions:
        portalPerms?.permissions ??
        resolveEffectivePortalPermissions({ role }),
    }),
    [role, ownEmployeeId, portalPerms?.permissions]
  );

  const canManagePayroll = canManageOrganizationPayroll(payrollCtx);
  const canViewOthersPayroll = canViewOthersPayrollData(payrollCtx);

  const isLaborPrivileged =
    role === "owner" ||
    role === "admin" ||
    role === "manager" ||
    role === "accountant";

  const items = useMemo(() => {
    return NAV.filter((item) => {
      if (item.payrollAdminOnly) return canManagePayroll;
      if (item.privilegedOnly) return isLaborPrivileged || canViewOthersPayroll;
      return true;
    });
  }, [canManagePayroll, canViewOthersPayroll, isLaborPrivileged]);

  return (
    <nav
      className="flex flex-wrap gap-2 border-b border-border pb-1"
      aria-label="Sekce práce a mzdy"
    >
      {items.map((item) => {
        const active =
          item.segment === "vykazy"
            ? pathname.startsWith("/portal/labor/dochazka") && isApprovalsTab
            : item.segment === "dochazka"
              ? pathname.startsWith("/portal/labor/dochazka") && !isApprovalsTab
              : pathname.startsWith(`/portal/labor/${item.segment}`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-t-md px-3 py-2.5 text-sm font-medium transition-colors min-h-[44px] sm:min-h-0 inline-flex items-center",
              active
                ? "border border-b-0 border-border bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
