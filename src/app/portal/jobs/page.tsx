"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Loader2,
  Briefcase,
  Calendar,
  Building2,
  FileStack,
  FileText,
  Ruler,
  ListTodo,
  Search,
  Tag,
  Camera,
  FileDown,
} from "lucide-react";
import {
  useFirestore,
  useCollection,
  useMemoFirebase,
  useUser,
  useDoc,
  useCompany,
} from "@/firebase";
import {
  collection,
  doc,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { JobTemplate, JobTemplateValues } from "@/lib/job-templates";
import {
  cloneQuestionnaireTemplateForJob,
  normalizeJobQuestionnaireTemplate,
} from "@/lib/job-customer-questionnaire";
import { syncAutoCustomerTasksForJob } from "@/lib/customer-job-tasks";
import { JobTemplateFormFields } from "@/components/jobs/job-template-form-fields";
import { WorkContractTemplatesManagerDialog } from "@/components/contracts/work-contract-templates-manager-dialog";
import { userCanManageMeasurements } from "@/lib/measurements";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";
import { OrganizationTasksDialog } from "@/components/tasks/organization-tasks-dialog";
import { MeasurementPhotoCaptureDialog } from "@/components/jobs/measurement-photo-capture-dialog";
import { sendModuleEmailNotificationFromBrowser } from "@/lib/email-notifications/client";
import {
  JOB_TAG_CUSTOM_VALUE,
  JOB_TAG_PRESETS,
  collectJobTagFilterOptions,
  jobTagLabel,
} from "@/lib/job-tags";
import { logActivitySafe } from "@/lib/activity-log";
import {
  buildJobBudgetFirestorePayload,
  normalizeBudgetType,
  normalizeVatRate,
  resolveJobBudgetFromFirestore,
  roundMoney2,
  VAT_RATE_OPTIONS,
  type JobBudgetType,
} from "@/lib/vat-calculations";
import {
  exportJobsToPdf,
  fetchImageAsDataUrl,
  type JobPdfExportRow,
} from "@/lib/pdf/exportJobsToPdf";
import { sumJobExpensesFromFirestore } from "@/lib/pdf/sum-job-expenses-client";
type JobsBoundaryProps = { children: ReactNode };
type JobsBoundaryState = { error: Error | null };

class JobsPageErrorBoundary extends Component<
  JobsBoundaryProps,
  JobsBoundaryState
> {
  constructor(props: JobsBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): JobsBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[JobsPage] ErrorBoundary:", error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="space-y-4 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <h1 className="text-xl font-semibold text-destructive">
            Chyba na stránce Zakázky
          </h1>
          <p className="font-mono text-sm text-slate-700 break-words">
            {this.state.error.message}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => this.setState({ error: null })}
          >
            Zkusit znovu
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Minimální tvar dokumentu zakázky z Firestore (useCollection přidává id). */
type JobRow = {
  id?: string;
  name?: string;
  description?: string;
  customerId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  assignedEmployeeIds?: string[];
  /** Typ / štítek zakázky (např. pergola, domy). */
  jobTag?: string | null;
};

function jobAssignsToUser(
  j: JobRow,
  userUid: string,
  employeeDocId?: string | undefined
): boolean {
  const raw = j?.assignedEmployeeIds;
  if (Array.isArray(raw)) {
    if (raw.includes(userUid)) return true;
    if (employeeDocId && raw.includes(employeeDocId)) return true;
    return false;
  }
  if (typeof raw === "string") {
    return raw === userUid || (!!employeeDocId && raw === employeeDocId);
  }
  return false;
}

function normalizeJobsList(
  allJobs: JobRow[] | null | undefined,
  isAdmin: boolean,
  userUid: string | undefined,
  employeeDocId?: string | undefined
): JobRow[] {
  const list = Array.isArray(allJobs) ? allJobs : [];
  if (isAdmin) return list;
  const uid = userUid ?? "";
  return list.filter((j) => jobAssignsToUser(j, uid, employeeDocId));
}

function JobsPageContent() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { company, companyName: tenantCompanyName } = useCompany();
  const { toast } = useToast();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);

  const companyId = profile?.companyId;
  const isAdmin =
    profile?.role === "owner" ||
    profile?.role === "admin" ||
    profile?.globalRoles?.includes("super_admin");

  const canManageTasks =
    profile?.role === "owner" ||
    profile?.role === "admin" ||
    profile?.role === "manager" ||
    profile?.role === "accountant" ||
    profile?.globalRoles?.includes("super_admin");

  const showTasksButton =
    !!companyId && profile?.role !== "customer";

  const showMeasurementPhotoEntry =
    !!companyId && !!user && !!firestore && profile?.role !== "customer";

  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "customers");
  }, [firestore, companyId]);
  const { data: customersData } = useCollection(customersQuery);

  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "jobs");
  }, [firestore, companyId]);

  const templatesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "jobTemplates");
  }, [firestore, companyId]);

  const { data: allJobs, isLoading } = useCollection(jobsQuery);
  const { data: templatesData } = useCollection(templatesQuery);

  const customers = useMemo(
    () => (Array.isArray(customersData) ? customersData : []),
    [customersData]
  );

  const templatesList = useMemo(
    () => (Array.isArray(templatesData) ? templatesData : []),
    [templatesData]
  );

  const employeeDocId = profile?.employeeId as string | undefined;
  const isPortalEmployee = profile?.role === "employee";

  const jobs = useMemo(
    () => normalizeJobsList(allJobs, !!isAdmin, user?.uid, employeeDocId),
    [allJobs, isAdmin, user?.uid, employeeDocId]
  );

  const searchParams = useSearchParams();
  const [isNewJobOpen, setIsNewJobOpen] = useState(false);
  const [newJob, setNewJob] = useState({
    name: "",
    description: "",
    customerId: "",
    status: "nová",
    budget: "",
    budgetType: "net" as JobBudgetType,
    vatRate: "21",
    startDate: "",
    endDate: "",
    measuring: "",
    measuringDetails: "",
    quickCustomerName: "",
    quickCustomerEmail: "",
    quickCustomerPhone: "",
    quickCustomerAddress: "",
    quickCustomerNotes: "",
    jobTag: "",
    jobTagCustom: "",
  });
  const [jobListSearch, setJobListSearch] = useState("");
  const [jobTagFilter, setJobTagFilter] = useState("");

  const jobTagFilterOptions = useMemo(
    () => collectJobTagFilterOptions(jobs as { jobTag?: string | null }[]),
    [jobs]
  );

  const filteredJobs = useMemo(() => {
    const q = jobListSearch.trim().toLowerCase();
    let list = jobs;
    if (q) {
      list = list.filter((j) => {
        const name = String(j?.name ?? "").toLowerCase();
        const desc = String(j?.description ?? "").toLowerCase();
        return name.includes(q) || desc.includes(q);
      });
    }
    if (jobTagFilter) {
      list = list.filter(
        (j) => String(j?.jobTag ?? "").trim() === jobTagFilter
      );
    }
    return list;
  }, [jobs, jobListSearch, jobTagFilter]);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [templateValues, setTemplateValues] = useState<JobTemplateValues>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [workContractTemplatesManagerOpen, setWorkContractTemplatesManagerOpen] =
    useState(false);
  const [tasksDialogOpen, setTasksDialogOpen] = useState(false);
  const [measurementPhotoDialogOpen, setMeasurementPhotoDialogOpen] =
    useState(false);
  const [exportPdfLoading, setExportPdfLoading] = useState(false);
  useEffect(() => {
    if (!isAdmin && workContractTemplatesManagerOpen) {
      setWorkContractTemplatesManagerOpen(false);
    }
  }, [isAdmin, workContractTemplatesManagerOpen]);

  const selectedTemplate = selectedTemplateId
    ? (templatesList.find((t) => t?.id === selectedTemplateId) as
        | JobTemplate
        | undefined)
    : undefined;

  useEffect(() => {
    const tId = searchParams.get("templateId");
    if (!tId || templatesList.length === 0) return;
    if (templatesList.some((t) => t?.id === tId)) {
      setSelectedTemplateId(tId);
      setIsNewJobOpen(true);
    }
  }, [searchParams, templatesList]);

  useEffect(() => {
    if (searchParams.get("tasks") === "1") {
      setTasksDialogOpen(true);
    }
  }, [searchParams]);

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !user) return;
    setIsSubmitting(true);

    try {
      const jobsColRef = collection(firestore, "companies", companyId, "jobs");
      const customersColRef = collection(
        firestore,
        "companies",
        companyId,
        "customers"
      );

      let customerId = "";
      let customerSnapshot: any | null = null;
      const customerFromList = Boolean(newJob.customerId?.trim());

      if (customerFromList) {
        customerId = newJob.customerId.trim();
        customerSnapshot =
          customers.find((c: { id?: string }) => c.id === customerId) ?? null;
      } else {
        const qName = newJob.quickCustomerName.trim();
        const qAddr = newJob.quickCustomerAddress.trim();
        const budgetEarly = newJob.budget.trim();

        if (!qName) {
          toast({
            variant: "destructive",
            title: "Zákazník",
            description:
              "Vyberte zákazníka ze seznamu, nebo vyplňte název firmy / jméno pro nového zákazníka.",
          });
          setIsSubmitting(false);
          return;
        }
        if (!qAddr) {
          toast({
            variant: "destructive",
            title: "Adresa",
            description:
              "Při zadání nového zákazníka ručně je adresa povinná.",
          });
          setIsSubmitting(false);
          return;
        }
        if (!budgetEarly) {
          toast({
            variant: "destructive",
            title: "Rozpočet",
            description:
              "Při zadání nového zákazníka ručně je rozpočet zakázky povinný.",
          });
          setIsSubmitting(false);
          return;
        }
        const budgetNumEarly = Math.round(Number(budgetEarly));
        if (!Number.isFinite(budgetNumEarly) || budgetNumEarly <= 0) {
          toast({
            variant: "destructive",
            title: "Rozpočet",
            description: "Zadejte platnou částku větší než 0.",
          });
          setIsSubmitting(false);
          return;
        }

        const candidates: any[] = [];

        if (newJob.quickCustomerEmail?.trim()) {
          const q = query(
            customersColRef,
            where("email", "==", newJob.quickCustomerEmail.trim())
          );
          const snap = await getDocs(q);
          snap.forEach((d) => candidates.push({ id: d.id, ...d.data() }));
        }

        if (!candidates.length && newJob.quickCustomerPhone?.trim()) {
          const q = query(
            customersColRef,
            where("phone", "==", newJob.quickCustomerPhone.trim())
          );
          const snap = await getDocs(q);
          snap.forEach((d) => candidates.push({ id: d.id, ...d.data() }));
        }

        if (!candidates.length && qName) {
          const q = query(
            customersColRef,
            where("companyName", "==", qName)
          );
          const snap = await getDocs(q);
          snap.forEach((d) => candidates.push({ id: d.id, ...d.data() }));
        }

        if (candidates.length) {
          customerSnapshot = candidates[0];
          customerId = customerSnapshot.id;
        } else {
          const customerPayload = {
            companyName: qName,
            email: newJob.quickCustomerEmail.trim() || "",
            phone: newJob.quickCustomerPhone.trim() || "",
            address: qAddr,
            notes: newJob.quickCustomerNotes.trim() || "",
            companyId,
            organizationId: companyId,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          const newRef = await addDoc(customersColRef, customerPayload);
          customerId = newRef.id;
          customerSnapshot = { id: customerId, ...customerPayload };

          toast({
            title: "Zákazník vytvořen",
            description: `„${qName}“ je uložen v adresáři zákazníků a propojen s touto zakázkou.`,
          });
        }
      }

      const customerName =
        customerSnapshot?.companyName ||
        newJob.quickCustomerName.trim() ||
        (customerSnapshot
          ? `${customerSnapshot.firstName || ""} ${
              customerSnapshot.lastName || ""
            }`.trim()
          : "");

      let budgetPayload: ReturnType<typeof buildJobBudgetFirestorePayload> | null =
        null;
      const budgetTrim = newJob.budget.trim();
      if (budgetTrim !== "") {
        const amount = Math.round(Number(budgetTrim));
        if (!Number.isFinite(amount) || amount <= 0) {
          toast({
            variant: "destructive",
            title: "Rozpočet",
            description: "Zadejte částku větší než 0 nebo nevyplňujte rozpočet.",
          });
          setIsSubmitting(false);
          return;
        }
        const vatRateNew = normalizeVatRate(Number(newJob.vatRate));
        const budgetTypeNew = normalizeBudgetType(newJob.budgetType);
        try {
          budgetPayload = buildJobBudgetFirestorePayload({
            budgetInput: amount,
            budgetType: budgetTypeNew,
            vatRate: vatRateNew,
          });
        } catch (e) {
          toast({
            variant: "destructive",
            title: "Rozpočet",
            description: e instanceof Error ? e.message : "Neplatná částka.",
          });
          setIsSubmitting(false);
          return;
        }
      }

      const payload: Record<string, unknown> = {
        name: newJob.name,
        description: newJob.description,
        status: newJob.status,
        ...(budgetPayload ? budgetPayload : {}),
        startDate: newJob.startDate,
        endDate: newJob.endDate,
        measuring: newJob.measuring,
        measuringDetails: newJob.measuringDetails,
        companyId,
        assignedEmployeeIds: [user.uid],
        customerId: customerId || null,
        customerName,
        customerPhone:
          customerSnapshot?.phone ||
          newJob.quickCustomerPhone?.trim() ||
          "",
        customerEmail:
          customerSnapshot?.email ||
          newJob.quickCustomerEmail?.trim() ||
          "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const resolvedJobTag =
        newJob.jobTag === JOB_TAG_CUSTOM_VALUE
          ? newJob.jobTagCustom.trim()
          : newJob.jobTag.trim();
      if (resolvedJobTag) {
        payload.jobTag = resolvedJobTag;
      }
      if (selectedTemplateId) {
        payload.templateId = selectedTemplateId;
        payload.templateValues = templateValues;
        const nq = normalizeJobQuestionnaireTemplate(
          (selectedTemplate as JobTemplate | undefined)?.questionnaire
        );
        if (nq && nq.active !== false && (nq.questions?.length ?? 0) > 0) {
          payload.customerQuestionnaireSnapshot = cloneQuestionnaireTemplateForJob(
            nq,
            selectedTemplateId
          );
        }
      }
      const createdJobRef = await addDoc(jobsColRef, payload);

      try {
        await syncAutoCustomerTasksForJob(
          firestore,
          companyId,
          createdJobRef.id,
          { ...payload, id: createdJobRef.id } as Record<string, unknown>,
          user.uid
        );
      } catch (e) {
        console.error("[JobsPage] syncAutoCustomerTasksForJob", e);
      }

      logActivitySafe(firestore, companyId, user, profile, {
        actionType: "job.create",
        actionLabel: "Vytvoření zakázky",
        entityType: "job",
        entityId: createdJobRef.id,
        entityName: newJob.name,
        details: budgetPayload
          ? `Stav ${newJob.status}, rozpočet ${budgetPayload.budgetNet} Kč bez DPH / ${budgetPayload.budgetGross} Kč s DPH (${budgetPayload.budgetType})`
          : `Stav ${newJob.status}, bez rozpočtu`,
        sourceModule: "jobs",
        route: `/portal/jobs/${createdJobRef.id}`,
        metadata: {
          status: newJob.status,
          ...(budgetPayload
            ? {
                budgetNet: budgetPayload.budgetNet,
                budgetGross: budgetPayload.budgetGross,
                budgetType: budgetPayload.budgetType,
                vatRate: budgetPayload.vatRate,
              }
            : {}),
          customerId: payload.customerId,
          customerName: payload.customerName,
        },
      });

      void sendModuleEmailNotificationFromBrowser({
        companyId,
        module: "orders",
        eventKey: "newOrder",
        entityId: createdJobRef.id,
        title: `Nová zakázka: ${newJob.name}`,
        lines: [
          `Zákazník: ${customerName}`,
          `Stav: ${newJob.status}`,
        ],
        actionPath: `/portal/jobs/${createdJobRef.id}`,
      });

      toast({
        title: "Zakázka vytvořena",
        description: `Zakázka "${newJob.name}" byla úspěšně přidána.`,
      });
      setIsNewJobOpen(false);
      setNewJob({
        name: "",
        description: "",
        customerId: "",
        status: "nová",
        budget: "",
        budgetType: "net" as JobBudgetType,
        vatRate: "21",
        startDate: "",
        endDate: "",
        measuring: "",
        measuringDetails: "",
        quickCustomerName: "",
        quickCustomerEmail: "",
        quickCustomerPhone: "",
        quickCustomerAddress: "",
        quickCustomerNotes: "",
        jobTag: "",
        jobTagCustom: "",
      });
      setSelectedTemplateId("");
      setTemplateValues({});
    } catch (error) {
      console.error("[JobsPage] handleCreateJob", error);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Nepodařilo se vytvořit zakázku.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: string | undefined | null) => {
    const key = typeof status === "string" ? status : "";
    const statuses: Record<
      string,
      {
        label: string;
        variant: "default" | "secondary" | "outline" | "destructive";
      }
    > = {
      nová: { label: "Nová", variant: "outline" },
      rozpracovaná: { label: "Rozpracovaná", variant: "secondary" },
      čeká: { label: "Čeká", variant: "outline" },
      dokončená: { label: "Dokončená", variant: "default" },
      fakturována: { label: "Fakturována", variant: "default" },
    };
    const s = statuses[key] || {
      label: key || "—",
      variant: "outline" as const,
    };
    return (
      <Badge variant={s.variant} className="capitalize">
        {s.label}
      </Badge>
    );
  };

  const getCustomerName = (id: string | undefined | null) => {
    if (id == null || id === "") return "Neznámý zákazník";
    const customer = customers.find((c) => c?.id === id);
    if (!customer) return "Neznámý zákazník";
    return (
      customer.companyName ||
      `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() ||
      "Neznámý zákazník"
    );
  };

  const jobStatusLabel = (status: string | undefined | null) => {
    const key = typeof status === "string" ? status : "";
    const map: Record<string, string> = {
      nová: "Nová",
      rozpracovaná: "Rozpracovaná",
      čeká: "Čeká",
      dokončená: "Dokončená",
      fakturována: "Fakturována",
    };
    return map[key] || (key ? key : "—");
  };

  const handleExportJobsPdf = async () => {
    if (!isAdmin || !firestore || !companyId) {
      toast({
        variant: "destructive",
        title: "Export",
        description: "Tuto akci mohou provést jen administrátoři.",
      });
      return;
    }
    if (filteredJobs.length === 0) {
      toast({
        variant: "destructive",
        title: "Export",
        description: "Nejsou žádné zakázky k exportu (zkontrolujte filtry).",
      });
      return;
    }
    setExportPdfLoading(true);
    try {
      let logoDataUrl: string | null = null;
      const logoUrl = company?.organizationLogoUrl;
      if (typeof logoUrl === "string" && logoUrl.trim()) {
        logoDataUrl = await fetchImageAsDataUrl(logoUrl.trim());
      }

      const rows: JobPdfExportRow[] = [];
      for (const job of filteredJobs) {
        const jid = job?.id;
        if (!jid) continue;
        const raw = job as unknown as Record<string, unknown>;
        const bd = resolveJobBudgetFromFirestore(raw);
        const costs = await sumJobExpensesFromFirestore(firestore, companyId, jid);
        const budgetRaw = bd?.budgetGross;
        const budgetGross =
          budgetRaw != null && Number.isFinite(Number(budgetRaw)) ? Number(budgetRaw) : 0;
        const costsGross = Number.isFinite(costs.gross) ? costs.gross : 0;
        const remainingGross =
          bd != null && budgetRaw != null && Number.isFinite(Number(budgetRaw))
            ? roundMoney2(Number(budgetRaw) - costsGross)
            : 0;

        const periodParts = [
          job?.startDate ? `Zahájení: ${job.startDate}` : "",
          job?.endDate ? `Dokončení: ${job.endDate}` : "",
        ].filter(Boolean);
        rows.push({
          jobName: String(job?.name ?? "—"),
          customer: getCustomerName(job?.customerId),
          statusLabel: jobStatusLabel(job?.status),
          budgetGross,
          costsGross,
          remainingGross,
          vatPercentLabel: bd ? `${bd.vatRate} %` : "0 %",
          periodLabel: periodParts.length ? periodParts.join(" · ") : "—",
        });
      }

      await exportJobsToPdf({
        jobs: rows,
        companyName: tenantCompanyName || "Organizace",
        logoDataUrl,
        fileName: `prehled-zakazek-${new Date().toISOString().slice(0, 10)}`,
      });

      toast({
        title: "PDF bylo vygenerováno",
        description: "Soubor byl stažen do vašeho zařízení.",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Export PDF",
        description: e instanceof Error ? e.message : "Generování se nezdařilo.",
      });
    } finally {
      setExportPdfLoading(false);
    }
  };

  if (isProfileLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-xl border-slate-200 bg-slate-50">
        <AlertTitle>Není vybraná firma</AlertTitle>
        <AlertDescription>
          Zakázky nelze načíst bez přiřazení k organizaci.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
        <div className="min-w-0">
          <h1 className="portal-page-title text-xl sm:text-2xl md:text-3xl break-words">
            Zakázky a Projekty
          </h1>
          <p className="portal-page-description">
            Správa firemních projektů vaší organizace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {userCanManageMeasurements(profile) && (
            <Link href="/portal/jobs/measurements">
              <Button
                type="button"
                className="gap-2 min-h-[44px] bg-emerald-600 hover:bg-emerald-700 text-white border-0 shadow-md shadow-emerald-600/25"
              >
                <Ruler className="w-4 h-4" />
                Zaměření
              </Button>
            </Link>
          )}
          {showMeasurementPhotoEntry ? (
            <>
              <Button
                type="button"
                variant="secondary"
                className="gap-2 min-h-[44px]"
                onClick={() => setMeasurementPhotoDialogOpen(true)}
              >
                <Camera className="w-4 h-4 shrink-0" />
                Foto zaměření
              </Button>
              <MeasurementPhotoCaptureDialog
                open={measurementPhotoDialogOpen}
                onOpenChange={setMeasurementPhotoDialogOpen}
                firestore={firestore}
                companyId={companyId}
                userId={user.uid}
                jobs={jobs as { id: string; name?: string }[]}
                customers={customers as { id: string; companyName?: string; firstName?: string; lastName?: string }[]}
                profile={profile as Record<string, unknown> | null | undefined}
              />
            </>
          ) : null}
          {isAdmin && (
            <>
              <Button
                type="button"
                className="gap-2 min-h-[44px] bg-orange-600 text-white hover:bg-orange-700 border-0 shadow-md shadow-orange-600/25"
                disabled={exportPdfLoading || filteredJobs.length === 0}
                onClick={() => void handleExportJobsPdf()}
              >
                {exportPdfLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                ) : (
                  <FileDown className="w-4 h-4 shrink-0" />
                )}
                Export PDF
              </Button>
              <Link href="/portal/jobs/templates">
                <Button variant="outlineLight" className="gap-2 min-h-[44px]">
                  <FileStack className="w-4 h-4" /> Šablony
                </Button>
              </Link>
              {showTasksButton && (
                <Button
                  type="button"
                  variant="outlineLight"
                  className="gap-2 min-h-[44px]"
                  onClick={() => setTasksDialogOpen(true)}
                >
                  <ListTodo className="w-4 h-4" /> Úkoly
                </Button>
              )}
              <Button
                type="button"
                className="gap-2 min-h-[44px] bg-orange-500 hover:bg-orange-600 text-white border-0 shadow-md shadow-orange-500/25"
                onClick={() => setWorkContractTemplatesManagerOpen(true)}
              >
                <FileText className="w-4 h-4" /> Šablony SOD
              </Button>
              <Dialog open={isNewJobOpen} onOpenChange={setIsNewJobOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2 min-h-[44px]">
                    <Plus className="w-4 h-4" /> Nová zakázka
                  </Button>
                </DialogTrigger>
                <DialogContent
                  className="bg-white border-slate-200 text-slate-900 max-w-3xl w-[95vw] sm:w-full max-h-[90vh] flex flex-col"
                  data-portal-dialog
                >
                  <DialogHeader className="shrink-0">
                    <DialogTitle>Vytvořit novou zakázku</DialogTitle>
                    <DialogDescription>
                      Zadejte základní informace o novém projektu. Zákazníka
                      vyberte ze seznamu, nebo vyplňte údaje níže — vznikne nový
                      záznam v sekci Zákazníci.
                    </DialogDescription>
                  </DialogHeader>
                  <form
                    onSubmit={handleCreateJob}
                    className="space-y-4 py-4 pr-1 sm:pr-0 flex-1 overflow-y-auto"
                  >
                    {!newJob.customerId &&
                    newJob.quickCustomerName.trim().length > 0 ? (
                      <Alert className="border-emerald-200 bg-emerald-50/90 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
                        <AlertTitle className="text-sm">
                          Nový zákazník
                        </AlertTitle>
                        <AlertDescription className="text-xs sm:text-sm">
                          Po uložení bude zákazník vytvořen v adresáři a propojen
                          s touto zakázkou. Vyplňte povinně jméno, adresu a
                          rozpočet.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    {!newJob.customerId &&
                    !newJob.quickCustomerName.trim() &&
                    !newJob.quickCustomerAddress.trim() &&
                    !newJob.budget.trim() ? (
                      <Alert>
                        <AlertTitle className="text-sm">
                          Bez výběru ze seznamu
                        </AlertTitle>
                        <AlertDescription className="text-xs sm:text-sm">
                          Pokud není vybrán zákazník v poli výše, vyplňte v sekci
                          „Rychlé údaje o zákazníkovi“ název, adresu a rozpočet —
                          jinak zakázku nelze uložit.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    {templatesList.length > 0 && (
                      <div className="space-y-2">
                        <Label htmlFor="new-job-template">
                          Šablona (volitelné)
                        </Label>
                        <select
                          id="new-job-template"
                          className={NATIVE_SELECT_CLASS}
                          value={selectedTemplateId || "none"}
                          onChange={(e) => {
                            const v = e.target.value;
                            setSelectedTemplateId(v === "none" ? "" : v);
                            setTemplateValues({});
                          }}
                        >
                          <option value="none">Bez šablony</option>
                          {templatesList
                            .filter((t) => t?.id)
                            .map((t) => (
                              <option key={String(t.id)} value={String(t.id)}>
                                {t.name ?? "Šablona"}{" "}
                                {t.productType ? `(${t.productType})` : ""}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2 col-span-2">
                        <Label htmlFor="name">Název zakázky</Label>
                        <Input
                          id="name"
                          required
                          value={newJob.name}
                          onChange={(e) =>
                            setNewJob({ ...newJob, name: e.target.value })
                          }
                          placeholder="Např. Montáž pergoly pro Novákovy"
                        />
                      </div>
                      <div className="space-y-2 col-span-2">
                        <Label htmlFor="description">Popis</Label>
                        <Textarea
                          id="description"
                          value={newJob.description}
                          onChange={(e) =>
                            setNewJob({
                              ...newJob,
                              description: e.target.value,
                            })
                          }
                          placeholder="Stručný popis projektu..."
                        />
                      </div>
                      <div className="space-y-2 col-span-2">
                        <Label htmlFor="new-job-tag">Typ / štítek zakázky</Label>
                        <select
                          id="new-job-tag"
                          className={NATIVE_SELECT_CLASS}
                          value={newJob.jobTag}
                          onChange={(e) =>
                            setNewJob({
                              ...newJob,
                              jobTag: e.target.value,
                            })
                          }
                        >
                          <option value="">Bez štítku</option>
                          {JOB_TAG_PRESETS.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                          <option value={JOB_TAG_CUSTOM_VALUE}>Vlastní…</option>
                        </select>
                        {newJob.jobTag === JOB_TAG_CUSTOM_VALUE ? (
                          <Input
                            className="mt-2"
                            value={newJob.jobTagCustom}
                            onChange={(e) =>
                              setNewJob({
                                ...newJob,
                                jobTagCustom: e.target.value,
                              })
                            }
                            placeholder="Zadejte vlastní typ (např. terasy, bazény)"
                          />
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-job-customer">Zákazník</Label>
                        <select
                          id="new-job-customer"
                          className={NATIVE_SELECT_CLASS}
                          value={newJob.customerId}
                          onChange={(e) =>
                            setNewJob({ ...newJob, customerId: e.target.value })
                          }
                        >
                          <option value="">Vyberte zákazníka</option>
                          {customers.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.companyName ||
                                `${c.firstName || ""} ${
                                  c.lastName || ""
                                }`.trim()}
                            </option>
                          ))}
                        </select>
                        {customers.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Žádní zákazníci.{" "}
                            <Link
                              href="/portal/customers"
                              className="text-primary hover:underline"
                            >
                              Vytvořit?
                            </Link>
                          </p>
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-job-price-type">Typ ceny</Label>
                        <select
                          id="new-job-price-type"
                          className={NATIVE_SELECT_CLASS}
                          value={newJob.budgetType}
                          onChange={(e) =>
                            setNewJob({
                              ...newJob,
                              budgetType: normalizeBudgetType(
                                e.target.value
                              ),
                            })
                          }
                        >
                          <option value="net">Cena bez DPH</option>
                          <option value="gross">Cena s DPH</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-job-vat">Sazba DPH</Label>
                        <select
                          id="new-job-vat"
                          className={NATIVE_SELECT_CLASS}
                          value={newJob.vatRate}
                          onChange={(e) =>
                            setNewJob({ ...newJob, vatRate: e.target.value })
                          }
                        >
                          {VAT_RATE_OPTIONS.map((r) => (
                            <option key={r} value={String(r)}>
                              {r} %
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="budget">
                          Rozpočet (Kč)
                          {newJob.customerId ? "" : " *"}
                        </Label>
                        <Input
                          id="budget"
                          type="number"
                          value={newJob.budget}
                          onChange={(e) =>
                            setNewJob({ ...newJob, budget: e.target.value })
                          }
                          placeholder={
                            newJob.budgetType === "gross"
                              ? "Částka s DPH"
                              : "Částka bez DPH"
                          }
                          min={1}
                          required={!newJob.customerId}
                        />
                        <p className="text-xs text-muted-foreground">
                          {newJob.customerId
                            ? "Volitelné. Hodnota odpovídá typu ceny."
                            : "Povinné při ručním zadání zákazníka. Hodnota odpovídá typu ceny."}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="startDate">Termín zahájení</Label>
                        <Input
                          id="startDate"
                          type="date"
                          value={newJob.startDate}
                          onChange={(e) =>
                            setNewJob({ ...newJob, startDate: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="endDate">Předpokládané dokončení</Label>
                        <Input
                          id="endDate"
                          type="date"
                          value={newJob.endDate}
                          onChange={(e) =>
                            setNewJob({ ...newJob, endDate: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2 col-span-2 border-t pt-4 mt-2">
                        <p className="text-xs uppercase font-bold text-muted-foreground tracking-wider">
                          Rychlé údaje o zákazníkovi
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2 col-span-2">
                            <Label htmlFor="quickCustomerName">
                              Název firmy / jméno
                            </Label>
                            <Input
                              id="quickCustomerName"
                              value={newJob.quickCustomerName}
                              onChange={(e) =>
                                setNewJob({
                                  ...newJob,
                                  quickCustomerName: e.target.value,
                                })
                              }
                              placeholder="Např. Novákovi s.r.o."
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="quickCustomerEmail">Email</Label>
                            <Input
                              id="quickCustomerEmail"
                              type="email"
                              value={newJob.quickCustomerEmail}
                              onChange={(e) =>
                                setNewJob({
                                  ...newJob,
                                  quickCustomerEmail: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="quickCustomerPhone">Telefon</Label>
                            <Input
                              id="quickCustomerPhone"
                              value={newJob.quickCustomerPhone}
                              onChange={(e) =>
                                setNewJob({
                                  ...newJob,
                                  quickCustomerPhone: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-2 col-span-2">
                            <Label htmlFor="quickCustomerAddress">
                              Adresa
                              {!newJob.customerId ? " *" : ""}
                            </Label>
                            <Input
                              id="quickCustomerAddress"
                              value={newJob.quickCustomerAddress}
                              onChange={(e) =>
                                setNewJob({
                                  ...newJob,
                                  quickCustomerAddress: e.target.value,
                                })
                              }
                              placeholder="Ulice, město, PSČ"
                              required={!newJob.customerId}
                            />
                          </div>
                          <div className="space-y-2 col-span-2">
                            <Label htmlFor="quickCustomerNotes">Poznámka</Label>
                            <Textarea
                              id="quickCustomerNotes"
                              value={newJob.quickCustomerNotes}
                              onChange={(e) =>
                                setNewJob({
                                  ...newJob,
                                  quickCustomerNotes: e.target.value,
                                })
                              }
                            />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2 col-span-2">
                        <Label htmlFor="measuring">Měření</Label>
                        <Textarea
                          id="measuring"
                          value={newJob.measuring}
                          onChange={(e) =>
                            setNewJob({ ...newJob, measuring: e.target.value })
                          }
                          placeholder="Rozsah a poznámky k měření..."
                        />
                      </div>
                      <div className="space-y-2 col-span-2">
                        <Label htmlFor="measuringDetails">Detaily měření</Label>
                        <Textarea
                          id="measuringDetails"
                          value={newJob.measuringDetails}
                          onChange={(e) =>
                            setNewJob({
                              ...newJob,
                              measuringDetails: e.target.value,
                            })
                          }
                          placeholder="Konkrétní rozměry, poznámky k místu atd."
                        />
                      </div>
                    </div>
                    {selectedTemplate ? (
                      <div className="border-t border-slate-200 pt-4 mt-4">
                        <h4 className="text-sm font-semibold text-slate-700 mb-3">
                          {(selectedTemplate as JobTemplate).name ?? "Šablona"}{" "}
                          – pole šablony
                        </h4>
                        <JobTemplateFormFields
                          template={selectedTemplate as JobTemplate}
                          values={templateValues ?? {}}
                          onChange={setTemplateValues}
                        />
                      </div>
                    ) : null}
                  </form>
                  <div className="shrink-0 border-t border-slate-200 pt-3 mt-2 bg-white">
                    <DialogFooter className="flex flex-row justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-[44px]"
                        onClick={() => setIsNewJobOpen(false)}
                      >
                        Zrušit
                      </Button>
                      <Button
                        type="submit"
                        disabled={isSubmitting}
                        className="min-h-[44px]"
                        form={undefined}
                        onClick={(e) => {
                          const dialogEl = (
                            e.currentTarget as HTMLButtonElement
                          ).closest(
                            "div[data-portal-dialog]"
                          ) as HTMLElement | null;
                          const formEl = dialogEl?.querySelector(
                            "form"
                          ) as HTMLFormElement | null;
                          if (formEl) {
                            formEl.requestSubmit();
                          }
                        }}
                      >
                        {isSubmitting ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          "Vytvořit zakázku"
                        )}
                      </Button>
                    </DialogFooter>
                  </div>
                </DialogContent>
              </Dialog>
            </>
          )}
          {!isAdmin && showTasksButton && (
            <Button
              type="button"
              variant="outlineLight"
              className="gap-2 min-h-[44px]"
              onClick={() => setTasksDialogOpen(true)}
            >
              <ListTodo className="w-4 h-4" /> Úkoly
            </Button>
          )}
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex-1 min-w-[200px] space-y-1.5">
              <Label htmlFor="jobs-search" className="text-xs text-slate-800">
                Vyhledávání
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-800 pointer-events-none" />
                <Input
                  id="jobs-search"
                  className="pl-9"
                  placeholder="Název nebo popis zakázky…"
                  value={jobListSearch}
                  onChange={(e) => setJobListSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="w-full sm:w-[min(100%,260px)] space-y-1.5">
              <Label
                htmlFor="jobs-tag-filter"
                className="text-xs text-slate-800 inline-flex items-center gap-1.5"
              >
                <Tag className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Štítek / typ
              </Label>
              <select
                id="jobs-tag-filter"
                className={NATIVE_SELECT_CLASS}
                value={jobTagFilter}
                onChange={(e) => setJobTagFilter(e.target.value)}
              >
                <option value="">Všechny zakázky</option>
                {jobTagFilterOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center p-8 sm:p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : jobs.length > 0 && filteredJobs.length === 0 ? (
            <div className="text-center py-16 px-4 text-slate-800 space-y-3">
              <p>Žádná zakázka neodpovídá vyhledávání nebo filtru štítku.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-[40px]"
                onClick={() => {
                  setJobListSearch("");
                  setJobTagFilter("");
                }}
              >
                Zrušit filtry
              </Button>
            </div>
          ) : filteredJobs.length > 0 ? (
            <Table className="min-w-[520px] w-full">
              <TableHeader>
                <TableRow className="border-slate-200 hover:bg-transparent">
                  <TableHead className="pl-4 sm:pl-6 min-w-0">Zakázka</TableHead>
                  <TableHead className="hidden md:table-cell">Zákazník</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead className="hidden lg:table-cell">Termíny</TableHead>
                  <TableHead className="pr-4 sm:pr-6 text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredJobs.map((job) => (
                  <TableRow
                    key={job?.id ?? `job-${job?.name}`}
                    className="border-slate-200 hover:bg-slate-50"
                  >
                    <TableCell className="pl-4 sm:pl-6 font-medium text-slate-900">
                      <div className="flex flex-col min-w-0 gap-1">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <span className="truncate">{job?.name ?? "—"}</span>
                          {job?.jobTag && String(job.jobTag).trim() ? (
                            <Badge
                              variant="secondary"
                              className="shrink-0 text-xs font-normal max-w-[10rem] truncate"
                              title={jobTagLabel(job.jobTag)}
                            >
                              {jobTagLabel(job.jobTag)}
                            </Badge>
                          ) : null}
                        </div>
                        <span className="text-xs text-slate-800 font-normal truncate max-w-[200px] sm:max-w-xs">
                          {job?.description ?? ""}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-700 hidden md:table-cell">
                      <div className="flex items-center gap-2 text-sm min-w-0">
                        <Building2 className="w-3 h-3 text-slate-800 shrink-0" />
                        <span className="truncate">
                          {getCustomerName(job?.customerId)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {getStatusBadge(job?.status)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex flex-col text-xs text-slate-700">
                        <span className="flex items-center gap-1 text-slate-800">
                          <Calendar className="w-3 h-3 shrink-0" /> Od:{" "}
                          {job?.startDate || "-"}
                        </span>
                        <span className="flex items-center gap-1 font-medium">
                          Do: {job?.endDate || "-"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="pr-4 sm:pr-6 text-right">
                      {job?.id ? (
                        <Link
                          href={
                            isPortalEmployee
                              ? `/portal/employee/jobs/${job.id}`
                              : `/portal/jobs/${job.id}`
                          }
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-slate-700 min-h-[44px] sm:min-h-0"
                          >
                            Detaily
                          </Button>
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-20 text-slate-800">
              <Briefcase className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>Zatím nemáte žádné zakázky.</p>
              {isAdmin && (
                <Button
                  variant="link"
                  className="text-primary"
                  onClick={() => setIsNewJobOpen(true)}
                >
                  Vytvořit první projekt
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <WorkContractTemplatesManagerDialog
        open={workContractTemplatesManagerOpen}
        onOpenChange={setWorkContractTemplatesManagerOpen}
        firestore={firestore}
        companyId={companyId}
        userId={user?.uid}
      />

      {companyId ? (
        <OrganizationTasksDialog
          open={tasksDialogOpen}
          onOpenChange={setTasksDialogOpen}
          companyId={companyId}
          canManage={canManageTasks}
          employeeId={profile?.employeeId as string | undefined}
        />
      ) : null}

    </div>
  );
}

export default function JobsPage() {
  return (
    <JobsPageErrorBoundary>
      <JobsPageContent />
    </JobsPageErrorBoundary>
  );
}
