"use client";

import { Suspense } from "react";
import { PublicAnalyticsBeacon } from "@/components/marketing/public-analytics-beacon";

export function PublicLandingAnalytics() {
  return (
    <Suspense fallback={null}>
      <PublicAnalyticsBeacon />
    </Suspense>
  );
}
