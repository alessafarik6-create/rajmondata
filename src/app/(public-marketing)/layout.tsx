import { Suspense } from "react";
import { PublicAnalyticsBeacon } from "@/components/marketing/public-analytics-beacon";

export default function PublicMarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <PublicAnalyticsBeacon />
      </Suspense>
      {children}
    </>
  );
}
