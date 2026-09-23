import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicAnalyticsBeacon } from "@/components/marketing/public-analytics-beacon";

export const metadata: Metadata = {
  robots: {
    index: true,
    follow: true,
  },
};

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
