"use client";

import { useParams } from "next/navigation";
import { AdminOrgAnalyticsDetail } from "@/components/admin/admin-org-analytics-detail";

export default function AdminOrgAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "").trim();
  return (
    <div className="space-y-4">
      <AdminOrgAnalyticsDetail organizationId={id} />
    </div>
  );
}
