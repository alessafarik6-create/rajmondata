"use client";

import { AdminSecurityDashboard } from "@/components/admin/admin-security-dashboard";

export default function AdminSecurityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Bezpečnost</h1>
        <p className="mt-1 text-slate-700">Monitoring incidentů, rate limitů a podezřelé aktivity.</p>
      </div>
      <AdminSecurityDashboard />
    </div>
  );
}
