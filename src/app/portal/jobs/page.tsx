"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Loader2,
  Briefcase,
  FileStack,
  FileText,
  Ruler,
  ListTodo,
  Search,
  Tag,
  Camera,
  FileDown,
  ArrowLeft,
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
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { JobTemplate, JobTemplateValues } from "@/lib/job-templates";
import {
  cloneQuestionnaireTemplateForJob,
  normalizeJobQuestionnaireTemplate,
} from "@/lib/job-customer-questionnaire";
import { syncAutoCustomerTasksForJob } from "@/lib/customer-job-tasks";
import { JobTemplateFormFields } from "@/components/jobs/job-template-form-fields";
import { WorkContractTemplatesManagerDialog } from "@/components/contracts/work-contract-templates-manager-dialog";
import {
  filterJobsListByDataScope,
  seeAllOrganizationRecordsForModule,
} from "@/lib/portal-data-scope";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";
import { OrganizationTasksDialog } from "@/components/tasks/organization-tasks-dialog";
import { MeasurementPhotoCaptureDialog } from "@/components/jobs/measurement-photo-capture-dialog";
import { DashboardUnassignedMeasurementPhotos } from "@/components/portal/dashboard-unassigned-measurement-photos";
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
import { exportContractedJobsToPdf } from "@/lib/pdf/exportContractedJobsToPdf";
import { sumJobExpensesFromFirestore } from "@/lib/pdf/sum-job-expenses-client";
import {
  buildContractedJobsExportRows,
  buildContractedJobsExportSummary,
  downloadContractedJobsCsv,
} from "@/lib/contracted-jobs-export";
import { useIsBelowLg } from "@/hooks/use-mobile";
import {
  countJobsByStatusFilter,
  DEFAULT_JOB_LIST_SORT,
  DEFAULT_JOB_STATUS_FILTER,
  jobStatusLabel,
  parseJobDeadlineFilterParam,
  parseJobListSortParam,
  parseJobStatusFilterParam,
  type JobDeadlineFilterKey,
  type JobListSortKey,
  type JobStatusFilterKey,
} from "@/lib/job-status";
import {
  applyJobListFilters,
  computeJobListSummary,
  sortJobs,
} from "@/lib/job-list-filters";
import { JobsListControls } from "@/components/jobs/jobs-list-controls";
import { JobsListView } from "@/components/jobs/jobs-list-view";
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
  createdAt?: unknown;
  updatedAt?: unknown;
  completedAt?: unknown;
  completedByName?: string;
};

function JobsPageContent() {
  const belowLg = useIsBelowLg();
  const router = useRouter();
  const { user } = useUser();
  const firestore = useFirestore();
  const { company, companyName: tenantCompanyName } = useCompany();
  const { toast } = useToast();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);
  const { canRead: canReadJobs } = usePortalModuleAccess("jobs");

  const companyId = profile?.companyId;
  const isAdmin =
    profile?.role === "owner" ||
    profile?.role === "admin" ||
    profile?.globalRoles?.includes("super_admin");

  const canManageTasks =
    profile?.role === "owner" ||
    profile?.role === "admin" ||
    profile?.role === "manager" ||
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

  const seeAllOrgJobs = useMemo(
    () =>
      seeAllOrganizationRecordsForModule("jobs", {
        role: profile?.role,
        globalRoles: profile?.globalRoles,
        moduleAccessAtLeastRead: canReadJobs,
      }),
    [profile?.role, profile?.globalRoles, canReadJobs]
  );

  const jobs = useMemo(
    () =>
      filterJobsListByDataScope(
        allJobs as JobRow[] | null | undefined,
        seeAllOrgJobs,
        user?.uid,
        employeeDocId
      ),
    [allJobs, seeAllOrgJobs, user?.uid, employeeDocId]
  );

  const jobNamesById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const j of jobs) {
      const id = String(j?.id ?? "").trim();
      if (!id) continue;
      m[id] = (typeof j.name === "string" && j.name.trim()) ? j.name.trim() : id;
    }
    return m;
  }, [jobs]);

  const jobsForAssign = useMemo(
    () =>
      jobs
        .map((j) => ({ id: String(j?.id ?? "").trim(), name: j.name }))
        .filter((j) => Boolean(j.id)),
    [jobs]
  );

  const searchParams = useSearchParams();
  const statusFilter = parseJobStatusFilterParam(searchParams.get("status"));
  const sortKey = parseJobListSortParam(searchParams.get("sort"));
  const deadlineFilter = parseJobDeadlineFilterParam(searchParams.get("deadline"));
  const jobListSearch = searchParams.get("q") ?? "";
  const jobTagFilter = searchParams.get("tag") ?? "";

  const syncJobsListUrl = useCallback(
    (patch: {
      status?: JobStatusFilterKey;
      sort?: JobListSortKey;
      search?: string;
      tag?: string;
      deadline?: JobDeadlineFilterKey | null;
    }) => {
      const params = new URLSearchParams(searchParams.toString());
      const nextStatus = patch.status ?? statusFilter;
      const nextSort = patch.sort ?? sortKey;
      const nextSearch =
        patch.search !== undefined ? patch.search : jobListSearch;
      const nextTag = patch.tag !== undefined ? patch.tag : jobTagFilter;
      const nextDeadline =
        patch.deadline !== undefined ? patch.deadline : deadlineFilter;

      if (nextStatus === DEFAULT_JOB_STATUS_FILTER) params.delete("status");
      else params.set("status", nextStatus);

      if (nextSort === DEFAULT_JOB_LIST_SORT) params.delete("sort");
      else params.set("sort", nextSort);

      const q = nextSearch.trim();
      if (q) params.set("q", q);
      else params.delete("q");

      const tag = nextTag.trim();
      if (tag) params.set("tag", tag);
      else params.delete("tag");

      if (nextDeadline) params.set("deadline", nextDeadline);
      else params.delete("deadline");

      const qs = params.toString();
      router.replace(qs ? `/portal/jobs?${qs}` : "/portal/jobs", { scroll: false });
    },
    [
      router,
      searchParams,
      statusFilter,
      sortKey,
      jobListSearch,
      jobTagFilter,
      deadlineFilter,
    ]
  );

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

  const jobTagFilterOptions = useMemo(
    () => collectJobTagFilterOptions(jobs as { jobTag?: string | null }[]),
    [jobs]
  );

  const getCustomerName = useCallback(
    (id: string | undefined | null) => {
      if (id == null || id === "") return "Neznámý zákazník";
      const customer = customers.find((c) => c?.id === id);
      if (!customer) return "Neznámý zákazník";
      return (
        customer.companyName ||
        `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() ||
        "Neznámý zákazník"
      );
    },
    [customers]
  );

  const getCustomerAddress = useCallback(
    (id: string | undefined | null) => {
      if (id == null || id === "") return "";
      const customer = customers.find((c) => c?.id === id) as
        | { address?: unknown }
        | undefined;
      if (!customer || customer.address == null) return "";
      return String(customer.address).trim();
    },
    [customers]
  );

  const listSummary = useMemo(() => computeJobListSummary(jobs), [jobs]);

  const statusCounts = useMemo(() => {
    const counts = {} as Record<JobStatusFilterKey, number>;
    const keys: JobStatusFilterKey[] = [
      "active",
      "all",
      "new",
      "in_progress",
      "waiting",
      "paused",
      "completed",
      "cancelled",
    ];
    for (const key of keys) {
      counts[key] = countJobsByStatusFilter(jobs, key);
    }
    return counts;
  }, [jobs]);

  const displayJobs = useMemo(() => {
    const filtered = applyJobListFilters(jobs, {
      search: jobListSearch,
      tagFilter: jobTagFilter,
      statusFilter,
      deadlineFilter,
      getCustomerName,
    });
    return sortJobs(filtered, sortKey, getCustomerName);
  }, [
    jobs,
    jobListSearch,
    jobTagFilter,
    statusFilter,
    deadlineFilter,
    sortKey,
    getCustomerName,
  ]);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [templateValues, setTemplateValues] = useState<JobTemplateValues>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [workContractTemplatesManagerOpen, setWorkContractTemplatesManagerOpen] =
    useState(false);
  const [tasksDialogOpen, setTasksDialogOpen] = useState(false);
  const [measurementPhotoDialogOpen, setMeasurementPhotoDialogOpen] =
    useState(false);
  const [exportPdfLoading, setExportPdfLoading] = useState(false);
  const [exportContractedLoading, setExportContractedLoading] = useState(false);

  const customersById = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const c of customers) {
      const id = String(c?.id ?? "").trim();
      if (id) m.set(id, c as Record<string, unknown>);
    }
    return m;
  }, [customers]);

  const jobsForExport = displayJobs;
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

  const handleExportJobsPdf = async () => {
    if (!isAdmin || !firestore || !companyId) {
      toast({
        variant: "destructive",
        title: "Export",
        description: "Tuto akci mohou provést jen administrátoři.",
      });
      return;
    }
    if (displayJobs.length === 0) {
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
      for (const job of displayJobs) {
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

  const handleExportContractedJobs = async (format: "pdf" | "csv") => {
    if (!isAdmin || !firestore || !companyId) {
      toast({
        variant: "destructive",
        title: "Export",
        description: "Tuto akci mohou provést jen administrátoři.",
      });
      return;
    }
    if (jobsForExport.length === 0) {
      toast({
        variant: "destructive",
        title: "Export",
        description: "Nejsou žádné zakázky k exportu (zkontrolujte filtry).",
      });
      return;
    }
    setExportContractedLoading(true);
    try {
      const jobsPayload = jobsForExport
        .map((j) => {
          const id = String(j?.id ?? "").trim();
          if (!id) return null;
          return { ...(j as Record<string, unknown>), id };
        })
        .filter(Boolean) as Array<Record<string, unknown> & { id: string }>;

      const rows = await buildContractedJobsExportRows({
        firestore,
        companyId,
        jobs: jobsPayload,
        customersById,
      });

      if (rows.length === 0) {
        toast({
          variant: "destructive",
          title: "Export zesmluvněných zakázek",
          description:
            "Ve filtrovaném seznamu není žádná zesmluvněná zakázka (smlouva, číslo SOD nebo stav „zesmluvněno“).",
        });
        return;
      }

      const summary = buildContractedJobsExportSummary(rows);
      const fileBase = `zesmluvnene-zakazky-${new Date().toISOString().slice(0, 10)}`;

      if (format === "csv") {
        downloadContractedJobsCsv(rows, summary, fileBase);
        toast({
          title: "CSV bylo vygenerováno",
          description: `Exportováno ${rows.length} zesmluvněných zakázek.`,
        });
        return;
      }

      let logoDataUrl: string | null = null;
      const logoUrl = company?.organizationLogoUrl;
      if (typeof logoUrl === "string" && logoUrl.trim()) {
        logoDataUrl = await fetchImageAsDataUrl(logoUrl.trim());
      }

      await exportContractedJobsToPdf({
        rows,
        summary,
        companyName: tenantCompanyName || "Organizace",
        logoDataUrl,
        fileName: fileBase,
      });

      toast({
        title: "PDF bylo vygenerováno",
        description: `Exportováno ${rows.length} zesmluvněných zakázek.`,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Export zesmluvněných zakázek",
        description: e instanceof Error ? e.message : "Generování se nezdařilo.",
      });
    } finally {
      setExportContractedLoading(false);
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
    <div
      className={cn(
        belowLg
          ? "flex w-full min-h-[100dvh] flex-col gap-3 overflow-x-hidden bg-slate-950 px-3 pb-[calc(96px+env(safe-area-inset-bottom))] pt-3 text-slate-50"
          : "mx-auto w-full max-w-[1920px] min-w-0 space-y-4 px-3 sm:space-y-5 sm:px-4 lg:px-5"
      )}
    >
      {belowLg ? (
        <>
          <div className="flex flex-col gap-2">
            <Button
              asChild
              variant="outline"
              className="h-9 w-fit min-w-0 shrink-0 rounded-lg border-white/20 bg-white/5 px-3 text-xs text-slate-100 hover:bg-white/10"
            >
              <Link href="/portal/dashboard">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Zpět
              </Link>
            </Button>
            <h1 className="text-lg font-semibold text-white">Zakázky</h1>
          </div>
          {(() => {
            const tileClass =
              "flex h-[84px] w-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-slate-900/85 px-0.5 py-1.5 text-center shadow-sm active:opacity-90";
            const labelClass =
              "line-clamp-2 text-center text-[10px] font-medium leading-tight text-slate-100";
            const row1: React.ReactNode[] = [];
            if (canReadJobs) {
              row1.push(
                <Link key="zamereni" href="/portal/jobs/measurements" className="min-w-0">
                  <div className={tileClass}>
                    <Ruler className="h-5 w-5 shrink-0 text-orange-400" />
                    <span className={labelClass}>Zaměření</span>
                  </div>
                </Link>
              );
            }
            if (showMeasurementPhotoEntry) {
              row1.push(
                <button
                  key="foto"
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => setMeasurementPhotoDialogOpen(true)}
                >
                  <div className={tileClass}>
                    <Camera className="h-5 w-5 shrink-0 text-orange-400" />
                    <span className={labelClass}>Foto zaměření</span>
                  </div>
                </button>
              );
            }
            if (isAdmin) {
              row1.push(
                <button
                  key="pdf"
                  type="button"
                  className={cn(
                    "min-w-0 text-left",
                    (exportPdfLoading || displayJobs.length === 0) &&
                      "pointer-events-none opacity-50"
                  )}
                  disabled={exportPdfLoading || displayJobs.length === 0}
                  onClick={() => void handleExportJobsPdf()}
                >
                  <div className={tileClass}>
                    {exportPdfLoading ? (
                      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-orange-400" />
                    ) : (
                      <FileDown className="h-5 w-5 shrink-0 text-orange-400" />
                    )}
                    <span className={labelClass}>Export PDF</span>
                  </div>
                </button>
              );
              row1.push(
                <Link key="sablony" href="/portal/jobs/templates" className="min-w-0">
                  <div className={tileClass}>
                    <FileStack className="h-5 w-5 shrink-0 text-orange-400" />
                    <span className={labelClass}>Šablony</span>
                  </div>
                </Link>
              );
            }
            return (
              <div className="space-y-1.5 pb-2">
                <div className="grid grid-cols-4 gap-1.5">{row1}</div>
                {isAdmin ? (
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      className={cn(
                        "min-w-0 text-left",
                        (exportContractedLoading || jobsForExport.length === 0) &&
                          "pointer-events-none opacity-50"
                      )}
                      disabled={
                        exportContractedLoading || jobsForExport.length === 0
                      }
                      onClick={() => void handleExportContractedJobs("pdf")}
                    >
                      <div className={tileClass}>
                        {exportContractedLoading ? (
                          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-orange-400" />
                        ) : (
                          <FileDown className="h-5 w-5 shrink-0 text-orange-400" />
                        )}
                        <span className={labelClass}>Zesmluvněné</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "min-w-0 text-left",
                        (exportContractedLoading || jobsForExport.length === 0) &&
                          "pointer-events-none opacity-50"
                      )}
                      disabled={
                        exportContractedLoading || jobsForExport.length === 0
                      }
                      onClick={() => void handleExportContractedJobs("csv")}
                    >
                      <div className={tileClass}>
                        <FileText className="h-5 w-5 shrink-0 text-orange-400" />
                        <span className={labelClass}>Zesml. CSV</span>
                      </div>
                    </button>
                  </div>
                ) : null}
                {isAdmin ? (
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => setWorkContractTemplatesManagerOpen(true)}
                    >
                      <div className={tileClass}>
                        <FileText className="h-5 w-5 shrink-0 text-orange-400" />
                        <span className={labelClass}>Šablony SOD</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => setIsNewJobOpen(true)}
                    >
                      <div className={tileClass}>
                        <Plus className="h-5 w-5 shrink-0 text-orange-400" />
                        <span className={labelClass}>Nová zakázka</span>
                      </div>
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })()}
          {belowLg && companyId && firestore && user && showMeasurementPhotoEntry ? (
            <DashboardUnassignedMeasurementPhotos
              variant="mobileDark"
              firestore={firestore}
              companyId={companyId}
              jobNamesById={jobNamesById}
              jobsForAssign={jobsForAssign}
              userId={user.uid}
              profile={profile as Record<string, unknown> | null | undefined}
            />
          ) : null}
        </>
      ) : null}

      {!belowLg ? (
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
          {canReadJobs && (
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
          {isAdmin && (
            <>
              <Button
                type="button"
                className="gap-2 min-h-[44px] bg-orange-600 text-white hover:bg-orange-700 border-0 shadow-md shadow-orange-600/25"
                disabled={exportPdfLoading || displayJobs.length === 0}
                onClick={() => void handleExportJobsPdf()}
              >
                {exportPdfLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                ) : (
                  <FileDown className="w-4 h-4 shrink-0" />
                )}
                Export PDF
              </Button>
              <Button
                type="button"
                variant="outlineLight"
                className="gap-2 min-h-[44px]"
                disabled={exportContractedLoading || jobsForExport.length === 0}
                onClick={() => void handleExportContractedJobs("pdf")}
              >
                {exportContractedLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                ) : (
                  <FileDown className="w-4 h-4 shrink-0" />
                )}
                Export zesmluvněných zakázek
              </Button>
              <Button
                type="button"
                variant="outlineLight"
                className="gap-2 min-h-[44px]"
                disabled={exportContractedLoading || jobsForExport.length === 0}
                onClick={() => void handleExportContractedJobs("csv")}
              >
                CSV zesmluvněných
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
              <Button
                type="button"
                className="gap-2 min-h-[44px]"
                onClick={() => setIsNewJobOpen(true)}
              >
                <Plus className="w-4 h-4" /> Nová zakázka
              </Button>
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
      ) : null}

      {showMeasurementPhotoEntry ? (
        <MeasurementPhotoCaptureDialog
          open={measurementPhotoDialogOpen}
          onOpenChange={setMeasurementPhotoDialogOpen}
          firestore={firestore}
          companyId={companyId}
          userId={user.uid}
          jobs={jobs as { id: string; name?: string }[]}
          customers={
            customers as {
              id: string;
              companyName?: string;
              firstName?: string;
              lastName?: string;
            }[]
          }
          profile={profile as Record<string, unknown> | null | undefined}
          standaloneReturnTo={belowLg ? "/portal/jobs" : null}
        />
      ) : null}

      {isAdmin ? (
        <Dialog open={isNewJobOpen} onOpenChange={setIsNewJobOpen}>
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
      ) : null}

      <Card
        className={cn(
          "shadow-sm",
          belowLg
            ? "border-white/10 bg-slate-900/85 text-slate-50 shadow-none"
            : "border-slate-200"
        )}
      >
        <CardContent className={cn(belowLg ? "p-2.5" : "p-4 sm:p-5")}>
          {belowLg ? (
            <div className="flex flex-col gap-2">
              <div className="flex min-w-0 flex-row items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="jobs-search"
                    className="!h-9 !min-h-9 rounded-md border border-white/35 !bg-slate-950 pl-8 !py-1 !text-xs !text-white shadow-none !placeholder:text-slate-400 focus-visible:border-orange-500/70 focus-visible:!ring-2 focus-visible:!ring-orange-500/40 [color-scheme:dark]"
                    placeholder="Hledat…"
                    value={jobListSearch}
                    onChange={(e) =>
                      syncJobsListUrl({ search: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <Tag className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                <select
                  id="jobs-tag-filter-mobile"
                  aria-label="Filtrovat podle štítku"
                  className="h-9 min-w-0 flex-1 cursor-pointer appearance-none rounded-md border border-white/35 !bg-slate-950 px-2 py-0 text-xs !text-white shadow-none outline-none focus:border-orange-500/70 focus:ring-2 focus:ring-orange-500/40 [color-scheme:dark]"
                  value={jobTagFilter}
                  onChange={(e) => syncJobsListUrl({ tag: e.target.value })}
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
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="min-w-[200px] flex-1 space-y-1.5">
                <Label htmlFor="jobs-search" className="text-xs text-slate-800">
                  Vyhledávání
                </Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-800" />
                  <Input
                    id="jobs-search"
                    className="pl-9"
                    placeholder="Název nebo popis zakázky…"
                    value={jobListSearch}
                    onChange={(e) =>
                      syncJobsListUrl({ search: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="w-full space-y-1.5 sm:w-[min(100%,260px)]">
                <Label
                  htmlFor="jobs-tag-filter"
                  className="inline-flex items-center gap-1.5 text-xs text-slate-800"
                >
                  <Tag className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Štítek / typ
                </Label>
                <select
                  id="jobs-tag-filter"
                  className={NATIVE_SELECT_CLASS}
                  value={jobTagFilter}
                  onChange={(e) => syncJobsListUrl({ tag: e.target.value })}
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
          )}
        </CardContent>
      </Card>

      <Card
        className={cn(
          "shadow-sm",
          belowLg
            ? "border-white/10 bg-slate-900/85 text-slate-50 shadow-none"
            : "border-slate-200"
        )}
      >
        <CardContent className={cn(belowLg ? "p-2.5" : "p-4 sm:p-5")}>
          <JobsListControls
            summary={listSummary}
            statusFilter={statusFilter}
            sortKey={sortKey}
            deadlineFilter={deadlineFilter}
            statusCounts={statusCounts}
            dark={belowLg}
            onStatusFilterChange={(key) =>
              syncJobsListUrl({ status: key, deadline: null })
            }
            onSortChange={(key) => syncJobsListUrl({ sort: key })}
            onSummaryClick={({ status, deadline }) =>
              syncJobsListUrl({ status, deadline })
            }
          />
        </CardContent>
      </Card>

      <Card
        className={cn(
          "overflow-hidden",
          belowLg ? "border-white/10 bg-slate-900/85 text-slate-50 shadow-none" : ""
        )}
      >
        <CardContent
          className={cn(
            "min-w-0 p-0",
            belowLg ? "overflow-x-hidden bg-slate-950" : "overflow-x-hidden"
          )}
        >
          {isLoading ? (
            <div
              className={cn(
                "flex items-center justify-center p-8 sm:p-12",
                belowLg && "bg-slate-950"
              )}
            >
              <Loader2
                className={cn(
                  "w-8 h-8 animate-spin",
                  belowLg ? "text-slate-300" : "text-primary"
                )}
              />
            </div>
          ) : jobs.length > 0 && displayJobs.length === 0 ? (
            <div
              className={cn(
                "space-y-3 px-4 py-16 text-center",
                belowLg ? "bg-slate-950 text-slate-200" : "text-slate-800"
              )}
            >
              <p className={belowLg ? "text-slate-200" : undefined}>
                Žádná zakázka neodpovídá zadaným filtrům nebo vyhledávání.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(
                  "min-h-[40px]",
                  belowLg &&
                    "border-white/25 bg-slate-800 text-slate-100 hover:bg-slate-700 hover:text-white"
                )}
                onClick={() =>
                  syncJobsListUrl({
                    status: DEFAULT_JOB_STATUS_FILTER,
                    sort: DEFAULT_JOB_LIST_SORT,
                    search: "",
                    tag: "",
                    deadline: null,
                  })
                }
              >
                Zrušit filtry
              </Button>
            </div>
          ) : displayJobs.length > 0 ? (
            <JobsListView
              jobs={displayJobs}
              getCustomerName={getCustomerName}
              getCustomerAddress={getCustomerAddress}
              isPortalEmployee={isPortalEmployee}
              isAdmin={isAdmin}
              dark={belowLg}
            />
          ) : (
            <div
              className={cn(
                "py-20 text-center",
                belowLg ? "bg-slate-950 text-slate-200" : "text-slate-800"
              )}
            >
              <Briefcase
                className={cn(
                  "mx-auto mb-4 h-12 w-12 opacity-20",
                  belowLg ? "text-slate-200" : ""
                )}
              />
              <p className={belowLg ? "text-slate-200" : undefined}>
                Zatím nemáte žádné zakázky.
              </p>
              {isAdmin && (
                <Button
                  variant="link"
                  className={cn(
                    belowLg
                      ? "text-orange-400 hover:text-orange-300"
                      : "text-primary"
                  )}
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
