import { Suspense } from "react";
import { LaborNav } from "./LaborNav";

export default function LaborSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 space-y-4 sm:space-y-6">
      <div className="min-w-0">
        <h1 className="portal-page-title text-xl sm:text-2xl md:text-3xl break-words">
          Práce a mzdy
        </h1>
        <p className="portal-page-description mt-1">
          Docházka, výkazy, výplaty a tarify interních činností na jednom místě.
        </p>
      </div>

      <Suspense
        fallback={
          <div
            className="h-11 w-full max-w-xl animate-pulse rounded-md bg-muted"
            aria-hidden
          />
        }
      >
        <LaborNav />
      </Suspense>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
