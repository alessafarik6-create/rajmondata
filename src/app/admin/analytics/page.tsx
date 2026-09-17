"use client";

import { AdminAnalyticsDashboard } from "@/components/admin/admin-analytics-dashboard";

export default function AdminAnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Analytika</h1>
        <p className="mt-1 text-slate-700">Návštěvnost veřejného webu a registrace organizací.</p>
      </div>
      <AdminAnalyticsDashboard />
    </div>
  );
}
