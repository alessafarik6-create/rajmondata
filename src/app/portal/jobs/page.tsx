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
  Inbox,
} from "lucide-react";
import {
  useFirestore,
  useCollection,
  useMemoFirebase,
  useUser,
  useDoc,
} from "@/firebase";
import {
  collection,
  doc,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  setDoc,
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
import { JobTemplateFormFields } from "@/components/jobs/job-template-form-fields";
import { WorkContractTemplatesManagerDialog } from "@/components/contracts/work-contract-templates-manager-dialog";
import { userCanManageMeasurements } from "@/lib/measurements";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";
import { OrganizationTasksDialog } from "@/components/tasks/organization-tasks-dialog";
import { LeadRequestsSection } from "@/components/jobs/lead-requests-section";

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
};

function jobAssignsToUser(
  j: JobRow,
  userUid: string
): boolean {
  const raw = j?.assignedEmployeeIds;
  if (Array.isArray(raw)) return raw.includes(userUid);
  if (typeof raw === "string") return raw === userUid;
  return false;
}

function normalizeJobsList(
  allJobs: JobRow[] | null | undefined,
  isAdmin: boolean,
  userUid: string | undefined
): JobRow[] {
  const list = Array.isArray(allJobs) ? allJobs : [];
  if (isAdmin) return list;
  const uid = userUid ?? "";
  return list.filter((j) => jobAssignsToUser(j, uid));
}

function JobsPageContent() {
  const { user } = useUser();
  const firestore = useFirestore();
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

  const jobs = useMemo(
    () => normalizeJobsList(allJobs, !!isAdmin, user?.uid),
    [allJobs, isAdmin, user?.uid]
  );

  const searchParams = useSearchParams();
  const [isNewJobOpen, setIsNewJobOpen] = useState(false);
  const [newJob, setNewJob] = useState({
    name: "",
    description: "",
    customerId: "",
    status: "nová",
    budget: "",
    startDate: "",
    endDate: "",
    measuring: "",
    measuringDetails: "",
    quickCustomerName: "",
    quickCustomerEmail: "",
    quickCustomerPhone: "",
    quickCustomerAddress: "",
    quickCustomerNotes: "",
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [templateValues, setTemplateValues] = useState<JobTemplateValues>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [workContractTemplatesManagerOpen, setWorkContractTemplatesManagerOpen] =
    useState(false);
  const [tasksDialogOpen, setTasksDialogOpen] = useState(false);
  const [leadRequestsSectionOpen, setLeadRequestsSectionOpen] = useState(false);

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

      let customerId = newJob.customerId || "";
      let customerSnapshot: any | null = null;

      if (
        !customerId &&
        (newJob.quickCustomerEmail ||
          newJob.quickCustomerPhone ||
          newJob.quickCustomerName)
      ) {
        const candidates: any[] = [];

        if (newJob.quickCustomerEmail) {
          const q = query(
            customersColRef,
            where("email", "==", newJob.quickCustomerEmail)
          );
          const snap = await getDocs(q);
          snap.forEach((d) => candidates.push({ id: d.id, ...d.data() }));
        }

        if (!candidates.length && newJob.quickCustomerPhone) {
          const q = query(
            customersColRef,
            where("phone", "==", newJob.quickCustomerPhone)
          );
          const snap = await getDocs(q);
          snap.forEach((d) => candidates.push({ id: d.id, ...d.data() }));
        }

        if (!candidates.length && newJob.quickCustomerName) {
          const q = query(
            customersColRef,
            where("companyName", "==", newJob.quickCustomerName)
          );
          const snap = await getDocs(q);
          snap.forEach((d) => candidates.push({ id: d.id, ...d.data() }));
        }

        if (candidates.length) {
          customerSnapshot = candidates[0];
          customerId = customerSnapshot.id;
        } else {
          const newCustomerRef = doc(customersColRef);
          customerId = newCustomerRef.id;
          const customerPayload = {
            companyName: newJob.quickCustomerName || "",
            email: newJob.quickCustomerEmail || "",
            phone: newJob.quickCustomerPhone || "",
            address: newJob.quickCustomerAddress || "",
            notes: newJob.quickCustomerNotes || "",
            companyId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(newCustomerRef, customerPayload);
          customerSnapshot = { id: customerId, ...customerPayload };

          toast({
            title: "Zákazník vytvořen",
            description:
              customerPayload.companyName ||
              customerPayload.email ||
              customerPayload.phone ||
              "Nový zákazník byl přidán.",
          });
        }
      }

      const customerName =
        customerSnapshot?.companyName ||
        newJob.quickCustomerName ||
        (customerSnapshot
          ? `${customerSnapshot.firstName || ""} ${
              customerSnapshot.lastName || ""
            }`.trim()
          : "");

      const payload: Record<string, unknown> = {
        name: newJob.name,
        description: newJob.description,
        status: newJob.status,
        budget: newJob.budget === "" ? 0 : Number(newJob.budget),
        startDate: newJob.startDate,
        endDate: newJob.endDate,
        measuring: newJob.measuring,
        measuringDetails: newJob.measuringDetails,
        companyId,
        assignedEmployeeIds: [user.uid],
        customerId: customerId || null,
        customerName,
        customerPhone:
          customerSnapshot?.phone || newJob.quickCustomerPhone || "",
        customerEmail:
          customerSnapshot?.email || newJob.quickCustomerEmail || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (selectedTemplateId) {
        payload.templateId = selectedTemplateId;
        payload.templateValues = templateValues;
      }
      await addDoc(jobsColRef, payload);

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
        startDate: "",
        endDate: "",
        measuring: "",
        measuringDetails: "",
        quickCustomerName: "",
        quickCustomerEmail: "",
        quickCustomerPhone: "",
        quickCustomerAddress: "",
        quickCustomerNotes: "",
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
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">
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
          {isAdmin && (
            <>
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
                      Zadejte základní informace o novém projektu.
                    </DialogDescription>
                  </DialogHeader>
                  <form
                    onSubmit={handleCreateJob}
                    className="space-y-4 py-4 pr-1 sm:pr-0 flex-1 overflow-y-auto"
                  >
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
                        <Label htmlFor="budget">Rozpočet (Kč)</Label>
                        <Input
                          id="budget"
                          type="number"
                          value={newJob.budget}
                          onChange={(e) =>
                            setNewJob({ ...newJob, budget: e.target.value })
                          }
                          placeholder="0"
                          min={0}
                        />
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
                            <Label htmlFor="quickCustomerAddress">Adresa</Label>
                            <Input
                              id="quickCustomerAddress"
                              value={newJob.quickCustomerAddress}
                              onChange={(e) =>
                                setNewJob({
                                  ...newJob,
                                  quickCustomerAddress: e.target.value,
                                })
                              }
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
          <Button
            type="button"
            variant={leadRequestsSectionOpen ? "default" : "outlineLight"}
            className="gap-2 min-h-[44px]"
            onClick={() => setLeadRequestsSectionOpen((v) => !v)}
          >
            <Inbox className="w-4 h-4" /> Poptávky
          </Button>
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

      <LeadRequestsSection
        companyId={companyId}
        active={leadRequestsSectionOpen}
        canScheduleMeasurement={userCanManageMeasurements(profile)}
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center p-8 sm:p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : jobs.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 hover:bg-transparent">
                  <TableHead className="pl-4 sm:pl-6">Zakázka</TableHead>
                  <TableHead className="hidden md:table-cell">Zákazník</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead className="hidden lg:table-cell">Termíny</TableHead>
                  <TableHead className="pr-4 sm:pr-6 text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow
                    key={job?.id ?? `job-${job?.name}`}
                    className="border-slate-200 hover:bg-slate-50"
                  >
                    <TableCell className="pl-4 sm:pl-6 font-medium text-slate-900">
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{job?.name ?? "—"}</span>
                        <span className="text-xs text-slate-600 font-normal truncate max-w-[200px] sm:max-w-xs">
                          {job?.description ?? ""}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-700 hidden md:table-cell">
                      <div className="flex items-center gap-2 text-sm min-w-0">
                        <Building2 className="w-3 h-3 text-slate-500 shrink-0" />
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
                        <span className="flex items-center gap-1 text-slate-600">
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
                        <Link href={`/portal/jobs/${job.id}`}>
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
            <div className="text-center py-20 text-slate-600">
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
