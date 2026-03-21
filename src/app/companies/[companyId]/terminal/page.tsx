"use client";

import { use } from "react";
import { AttendanceTerminal } from "@/components/attendance/AttendanceTerminal";

export default function CompanyTerminalPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = use(params);
  return <AttendanceTerminal standalone companyIdOverride={companyId} />;
}
