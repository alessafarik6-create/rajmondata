"use client";

import { AdminAnalyticsDashboard } from "@/components/admin/admin-analytics-dashboard";
import { AdminPortalAnalyticsDashboard } from "@/components/admin/admin-portal-analytics-dashboard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function AdminAnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Analytika</h1>
        <p className="mt-1 text-slate-700">
          Veřejný web, využívání firemního portálu a přehled organizací (pouze superadmin).
        </p>
      </div>

      <Tabs defaultValue="portal">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="portal">Portál a organizace</TabsTrigger>
          <TabsTrigger value="web">Veřejný web</TabsTrigger>
        </TabsList>
        <TabsContent value="portal" className="mt-4">
          <AdminPortalAnalyticsDashboard />
        </TabsContent>
        <TabsContent value="web" className="mt-4">
          <AdminAnalyticsDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
