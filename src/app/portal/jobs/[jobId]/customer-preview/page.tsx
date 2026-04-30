"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useUser,
  useFirestore,
  useDoc,
  useMemoFirebase,
  useCollection,
} from "@/firebase";
import { collection, doc, query, where, limit } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, ChevronLeft } from "lucide-react";
import { CustomerJobView } from "@/components/customer/customer-job-view";
import { getJobCustomerPortalPreviewGate } from "@/lib/job-customer-portal-preview";

export default function AdminCustomerJobPreviewPage() {
  const params = useParams();
  const jobIdRaw = params?.jobId;
  const jobId = Array.isArray(jobIdRaw) ? jobIdRaw[0] : jobIdRaw;

  const { user } = useUser();
  const firestore = useFirestore();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc(userRef);
  const companyId = profile?.companyId as string | undefined;

  const isOrgAdmin =
    profile?.role === "owner" ||
    profile?.role === "admin" ||
    (Array.isArray(profile?.globalRoles) && profile.globalRoles.includes("super_admin"));

  const jobRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId && typeof jobId === "string"
        ? doc(firestore, "companies", companyId, "jobs", jobId)
        : null,
    [firestore, companyId, jobId]
  );
  const { data: jobDoc, isLoading: jobLoading } = useDoc(jobRef);

  const crmCustomerId = useMemo(() => {
    const j = jobDoc as Record<string, unknown> | null | undefined;
    const raw =
      (typeof j?.customerId === "string" && j.customerId.trim()) ||
      (typeof j?.customer_id === "string" && String(j.customer_id).trim()) ||
      (typeof j?.customerID === "string" && String(j.customerID).trim()) ||
      "";
    return raw || null;
  }, [jobDoc]);

  const customerRef = useMemoFirebase(
    () =>
      firestore && companyId && crmCustomerId
        ? doc(firestore, "companies", companyId, "customers", crmCustomerId)
        : null,
    [firestore, companyId, crmCustomerId]
  );
  const { data: customerDoc } = useDoc(customerRef);

  const portalCustomerUsersQuery = useMemoFirebase(
    () =>
      firestore && crmCustomerId
        ? query(
            collection(firestore, "users"),
            where("customerRecordId", "==", crmCustomerId),
            where("role", "==", "customer"),
            limit(1)
          )
        : null,
    [firestore, crmCustomerId]
  );
  const { data: portalCustomerUsersRows } = useCollection<{ id?: string }>(
    portalCustomerUsersQuery,
    { suppressGlobalPermissionError: true }
  );
  const customerPortalUserDocId =
    portalCustomerUsersRows &&
    portalCustomerUsersRows[0] &&
    typeof portalCustomerUsersRows[0].id === "string"
      ? portalCustomerUsersRows[0].id.trim()
      : null;

  const photosColRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId && typeof jobId === "string"
        ? collection(firestore, "companies", companyId, "jobs", jobId, "photos")
        : null,
    [firestore, companyId, jobId]
  );
  const { data: legacyPhotosData } = useCollection(photosColRef);
  const legacyPhotos = legacyPhotosData ?? undefined;

  const previewGate = useMemo(
    () =>
      getJobCustomerPortalPreviewGate(jobDoc as Record<string, unknown> | null | undefined, {
        customer: (customerDoc as Record<string, unknown> | null | undefined) ?? null,
        customerPortalUserDocId,
      }),
    [jobDoc, customerDoc, customerPortalUserDocId]
  );

  const effectiveCustomerUid =
    previewGate.show && !previewGate.disabled ? previewGate.customerUid : null;

  if (!user || profileLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isOrgAdmin) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Alert variant="destructive">
          <AlertTitle>Přístup zamítnut</AlertTitle>
          <AlertDescription>
            Náhled zákaznického portálu mohou otevřít pouze administrátoři organizace.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (String(profile?.role || "").trim() === "customer") {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Alert>
          <AlertTitle>Přístup</AlertTitle>
          <AlertDescription>Použijte firemní účet administrátora.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!companyId || !jobId || typeof jobId !== "string") {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Alert>
          <AlertTitle>Chybí údaje</AlertTitle>
          <AlertDescription>Zakázku nelze načíst.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (jobLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!jobDoc) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Alert>
          <AlertTitle>Zakázka nenalezena</AlertTitle>
          <AlertDescription>
            V této organizaci neexistuje zakázka s tímto identifikátorem.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!previewGate.show || previewGate.disabled || !effectiveCustomerUid) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <Alert>
          <AlertTitle>Náhled není k dispozici</AlertTitle>
          <AlertDescription>
            {previewGate.show && previewGate.disabled
              ? "Zákaznický profil (přihlášení do portálu) ještě není přiřazen k zakázce. Po pozvání zákazníka se náhled zpřístupní."
              : "U této zakázky není nastaven zákaznický přístup."}
          </AlertDescription>
        </Alert>
        <Button variant="outline" asChild>
          <Link href={`/portal/jobs/${jobId}`} className="gap-1">
            <ChevronLeft className="h-4 w-4" />
            Zpět do zakázky
          </Link>
        </Button>
      </div>
    );
  }

  const previewBase = `/portal/jobs/${jobId}/customer-preview`;

  return (
    <div className="min-h-0">
      <div className="border-b-2 border-amber-500 bg-amber-50 px-3 py-3 text-amber-950 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-50">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold leading-snug sm:text-base">
            Náhled zákazníka – zobrazujete, co vidí zákazník (pouze ke čtení).
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 border-amber-800/30 bg-white/80 text-amber-950 hover:bg-white dark:border-amber-400/40 dark:bg-amber-900/50 dark:text-amber-50"
            asChild
          >
            <Link href={`/portal/jobs/${jobId}`} className="gap-1">
              <ChevronLeft className="h-4 w-4" />
              Zpět do zakázky
            </Link>
          </Button>
        </div>
      </div>

      {user ? (
        <CustomerJobView
          companyId={companyId}
          jobId={jobId}
          jobDoc={jobDoc as Record<string, unknown>}
          legacyPhotos={
            legacyPhotos as Array<Record<string, unknown> & { id: string }> | undefined
          }
          customerUid={effectiveCustomerUid}
          viewerUser={user}
          readOnly
          taskLinkBase={previewBase}
          topBar={null}
        />
      ) : null}
    </div>
  );
}
