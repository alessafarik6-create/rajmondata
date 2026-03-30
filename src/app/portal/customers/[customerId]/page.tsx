
"use client";
import { Loader2 } from "lucide-react";

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, where, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  ChevronLeft, 
  Building2, 
  Mail, 
  Phone, 
  MapPin, 
  Calendar,
  Briefcase,
  History,
  Edit2,
  User,
  KeyRound,
  Shield,
  Copy,
  RefreshCw,
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { getJobMediaPreviewUrl, formatMediaDate } from '@/lib/job-media-types';
import type { MeasurementPhotoStatus } from '@/lib/measurement-photos';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MIN_EMPLOYEE_PASSWORD_LENGTH } from '@/lib/employee-password-policy';

export default function CustomerDetailPage() {
  const { customerId } = useParams();
  const router = useRouter();
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const userRef = useMemoFirebase(() => user && firestore ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);
  const companyId = profile?.companyId;

  const customerRef = useMemoFirebase(() => companyId && customerId ? doc(firestore, 'companies', companyId, 'customers', customerId as string) : null, [firestore, companyId, customerId]);
  const { data: customer, isLoading } = useDoc(customerRef);

  // Načtení zakázek tohoto zákazníka
  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !customerId) return null;
    return query(
      collection(firestore, 'companies', companyId, 'jobs'),
      where('customerId', '==', customerId)
    );
  }, [firestore, companyId, customerId]);

  const { data: jobs, isLoading: isJobsLoading } = useCollection(jobsQuery);

  const measurementPhotosQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !customerId) return null;
    return query(
      collection(firestore, 'companies', companyId, 'measurement_photos'),
      where('customerId', '==', customerId as string)
    );
  }, [firestore, companyId, customerId]);

  const { data: measurementPhotos, isLoading: measurementPhotosLoading } =
    useCollection(measurementPhotosQuery);

  const [transferPhotoId, setTransferPhotoId] = useState<string | null>(null);
  const [transferJobId, setTransferJobId] = useState('');
  const [transferSaving, setTransferSaving] = useState(false);

  const canManagePortal = ['owner', 'admin'].includes(String(profile?.role || ''));
  const [portalDialogOpen, setPortalDialogOpen] = useState(false);
  const [portalEmail, setPortalEmail] = useState('');
  const [portalPassword, setPortalPassword] = useState('');
  const [portalPassword2, setPortalPassword2] = useState('');
  const [portalSubmitting, setPortalSubmitting] = useState(false);
  const [resetLinkDialogOpen, setResetLinkDialogOpen] = useState(false);
  const [resetLinkValue, setResetLinkValue] = useState('');
  const [portalActionLoading, setPortalActionLoading] = useState(false);

  const crm = (customer ?? {}) as Record<string, unknown> & {
    customerPortalUid?: string;
    customerPortalEmail?: string;
    customerPortalEnabled?: boolean;
  };
  const portalUid = typeof crm.customerPortalUid === 'string' ? crm.customerPortalUid.trim() : '';
  const portalEmailStored =
    typeof crm.customerPortalEmail === 'string' ? crm.customerPortalEmail.trim() : '';
  const portalEnabled = crm.customerPortalEnabled !== false;

  const handleTransferMeasurementPhotoToJob = async () => {
    if (!firestore || !companyId || !transferPhotoId || !transferJobId.trim()) {
      toast({
        variant: 'destructive',
        title: 'Vyberte zakázku',
        description: 'Zvolte zakázku, ke které chcete foto přiřadit.',
      });
      return;
    }
    setTransferSaving(true);
    try {
      await updateDoc(
        doc(
          firestore,
          'companies',
          companyId,
          'measurement_photos',
          transferPhotoId
        ),
        {
          jobId: transferJobId.trim(),
          status: 'linked' as MeasurementPhotoStatus,
          updatedAt: serverTimestamp(),
        }
      );
      toast({
        title: 'Foto zaměření bylo přiřazeno k zakázce',
        description: 'Fotku najdete v detailu zakázky v sekci Foto zaměření.',
      });
      setTransferPhotoId(null);
      setTransferJobId('');
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'Přiřazení se nezdařilo',
        description: 'Zkuste to znovu nebo kontaktujte správce.',
      });
    } finally {
      setTransferSaving(false);
    }
  };

  if (isProfileLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-xl border-slate-200 bg-slate-50">
        <AlertTitle>Není vybraná firma</AlertTitle>
        <AlertDescription>
          Detail zákazníka nelze načíst bez přiřazení k organizaci.
        </AlertDescription>
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold">Zákazník nenalezen</h2>
        <Button variant="link" onClick={() => router.push('/portal/customers')}>Zpět na seznam</Button>
      </div>
    );
  }

  const openPortalCreateDialog = () => {
    setPortalEmail(String(customer.email || '').trim());
    setPortalPassword('');
    setPortalPassword2('');
    setPortalDialogOpen(true);
  };

  const handleCreatePortalAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canManagePortal) return;
    if (portalPassword.length < MIN_EMPLOYEE_PASSWORD_LENGTH) {
      toast({
        variant: 'destructive',
        title: 'Slabé heslo',
        description: `Heslo musí mít alespoň ${MIN_EMPLOYEE_PASSWORD_LENGTH} znaků.`,
      });
      return;
    }
    if (portalPassword !== portalPassword2) {
      toast({ variant: 'destructive', title: 'Hesla se neshodují' });
      return;
    }
    setPortalSubmitting(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/company/customers/create-portal-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          customerId: customerId as string,
          email: portalEmail.trim() || undefined,
          password: portalPassword,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Vytvoření účtu selhalo.');
      }
      toast({
        title: 'Klientský účet vytvořen',
        description:
          data.message ||
          'Zákazník se přihlásí stejně jako firma; uvidí jen svůj klientský portál.',
      });
      setPortalDialogOpen(false);
      setPortalPassword('');
      setPortalPassword2('');
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Chyba',
        description: err instanceof Error ? err.message : 'Nepodařilo se vytvořit účet.',
      });
    } finally {
      setPortalSubmitting(false);
    }
  };

  const handleSyncPortalJobs = async () => {
    if (!user || !canManagePortal) return;
    setPortalActionLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/company/customers/sync-portal-linked-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ customerId: customerId as string }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; count?: number };
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Synchronizace selhala.');
      }
      toast({
        title: 'Zakázky synchronizovány',
        description: `Do portálu je přiřazeno ${data.count ?? 0} zakázek (podle CRM).`,
      });
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Chyba',
        description: err instanceof Error ? err.message : 'Synchronizace selhala.',
      });
    } finally {
      setPortalActionLoading(false);
    }
  };

  const handlePortalPasswordResetLink = async () => {
    if (!user || !canManagePortal) return;
    setPortalActionLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/company/customers/portal-password-reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ customerId: customerId as string }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        resetLink?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Odkaz se nepodařilo vygenerovat.');
      }
      if (data.resetLink) {
        setResetLinkValue(data.resetLink);
        setResetLinkDialogOpen(true);
      }
      if (data.message) {
        toast({ title: 'Odkaz připraven', description: data.message });
      }
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Chyba',
        description: err instanceof Error ? err.message : 'Vygenerování odkazu selhalo.',
      });
    } finally {
      setPortalActionLoading(false);
    }
  };

  const handleSetPortalEnabled = async (enabled: boolean) => {
    if (!user || !canManagePortal) return;
    setPortalActionLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/company/customers/set-portal-enabled', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ customerId: customerId as string, enabled }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Změna stavu selhala.');
      }
      toast({
        title: enabled ? 'Přístup povolen' : 'Přístup deaktivován',
        description: data.message,
      });
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Chyba',
        description: err instanceof Error ? err.message : 'Změna stavu selhala.',
      });
    } finally {
      setPortalActionLoading(false);
    }
  };

  const copyResetLink = async () => {
    try {
      await navigator.clipboard.writeText(resetLinkValue);
      toast({ title: 'Zkopírováno do schránky' });
    } catch {
      toast({ variant: 'destructive', title: 'Kopírování selhalo' });
    }
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/portal/customers')}>
          <ChevronLeft className="w-6 h-6" />
        </Button>
        <div className="flex-1">
          <h1 className="portal-page-title">{customer.companyName || `${customer.firstName} ${customer.lastName}`}</h1>
          <p className="text-muted-foreground">Profil zákazníka a historie spolupráce</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2"><Edit2 className="w-4 h-4" /> Upravit profil</Button>
          <Link href="/portal/jobs">
            <Button className="gap-2"><Briefcase className="w-4 h-4" /> Nová zakázka</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card className="bg-surface border-border shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Základní údaje</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <Building2 className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold">Firma / Název</p>
                  <p className="font-semibold">{customer.companyName || '-'}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <User className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold">Kontaktní osoba</p>
                  <p className="font-semibold">{customer.firstName} {customer.lastName}</p>
                </div>
              </div>
              <Separator className="bg-border/50" />
              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold">Email</p>
                  <p className="font-semibold select-all">{customer.email || '-'}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold">Telefon</p>
                  <p className="font-semibold">{customer.phone || '-'}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold">Adresa</p>
                  <p className="text-sm">{customer.address || '-'}</p>
                </div>
              </div>
              {customer.ico && (
                <div className="pt-2">
                  <Badge variant="outline" className="font-mono text-[10px] tracking-tighter">IČO: {customer.ico}</Badge>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-surface border-border shadow-lg">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                <CardTitle className="text-lg">Klientský portál</CardTitle>
              </div>
              <CardDescription>
                Přihlášení zákazníka (Firebase Auth, role <code className="text-xs">customer</code>). Stejná přihlašovací
                stránka jako u firmy — po přihlášení přesměrování do portálu zákazníka.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {!portalUid ? (
                <p className="text-muted-foreground">
                  Účet pro zákazníka zatím není vytvořen. Přístup do portálu neexistuje, dokud ho zde nezaložíte.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground uppercase font-bold">Stav</span>
                    <Badge variant={portalEnabled ? 'default' : 'secondary'}>
                      {portalEnabled ? 'Aktivní' : 'Deaktivovaný'}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold">E-mail přihlášení</p>
                    <p className="font-mono text-xs break-all select-all">
                      {portalEmailStored || customer.email || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold">UID (Firebase)</p>
                    <p className="font-mono text-[10px] break-all select-all">{portalUid}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold">Zakázek v portálu (sync)</p>
                    <p>{jobs?.length ?? 0} (podle CRM u tohoto zákazníka)</p>
                  </div>
                </div>
              )}

              {canManagePortal ? (
                <div className="flex flex-col gap-2 pt-2">
                  {!portalUid ? (
                    <Button type="button" className="w-full gap-2" onClick={openPortalCreateDialog}>
                      <KeyRound className="w-4 h-4" />
                      Vytvořit přístup do portálu
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full gap-2"
                        disabled={portalActionLoading}
                        onClick={() => void handleSyncPortalJobs()}
                      >
                        <RefreshCw className="w-4 h-4" />
                        Synchronizovat zakázky do portálu
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full gap-2"
                        disabled={portalActionLoading || !portalEnabled}
                        onClick={() => void handlePortalPasswordResetLink()}
                      >
                        <KeyRound className="w-4 h-4" />
                        Odkaz pro reset hesla
                      </Button>
                      {portalEnabled ? (
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full"
                          disabled={portalActionLoading}
                          onClick={() => void handleSetPortalEnabled(false)}
                        >
                          Deaktivovat přístup
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          className="w-full"
                          disabled={portalActionLoading}
                          onClick={() => void handleSetPortalEnabled(true)}
                        >
                          Znovu povolit přístup
                        </Button>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground pt-1">
                  Správu přístupu může provést vlastník nebo administrátor firmy.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle className="text-lg">Poznámky</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground italic leading-relaxed">
                {customer.notes || 'Žádné interní poznámky.'}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle>Foto zaměření</CardTitle>
              <CardDescription>
                Snímky s kótami uložené k tomuto zákazníkovi. Po přiřazení k zakázce se zobrazí i u zakázky.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {measurementPhotosLoading ? (
                <div className="flex justify-center p-6">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : measurementPhotos && measurementPhotos.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {measurementPhotos.map((p: Record<string, unknown> & { id: string; jobId?: string }) => {
                    const url = getJobMediaPreviewUrl({
                      annotatedImageUrl: typeof p.annotatedImageUrl === 'string' ? p.annotatedImageUrl : undefined,
                      imageUrl: typeof p.originalImageUrl === 'string' ? p.originalImageUrl : undefined,
                    });
                    const hasJob = typeof p.jobId === 'string' && p.jobId.length > 0;
                    return (
                      <div key={p.id} className="rounded-lg border border-border overflow-hidden bg-background/40">
                        <div className="aspect-square bg-muted/30">
                          {url ? (
                            <img src={url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs text-muted-foreground p-2">
                              Bez náhledu
                            </div>
                          )}
                        </div>
                        <div className="p-2 space-y-2">
                          <p className="text-[10px] text-muted-foreground">
                            {formatMediaDate(p.createdAt)}
                          </p>
                          {hasJob ? (
                            <Link
                              href={`/portal/jobs/${p.jobId}`}
                              className="text-xs text-primary hover:underline block"
                            >
                              Otevřít zakázku
                            </Link>
                          ) : (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="w-full h-8 text-xs"
                              onClick={() => {
                                setTransferPhotoId(p.id);
                                setTransferJobId('');
                              }}
                            >
                              Převést k zakázce
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Zatím žádné foto zaměření u tohoto zákazníka.</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-surface border-border">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Historie zakázek</CardTitle>
                <CardDescription>Všechny projekty realizované pro tohoto zákazníka</CardDescription>
              </div>
              <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                {jobs?.length || 0} celkem
              </Badge>
            </CardHeader>
            <CardContent>
              {isJobsLoading ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : jobs && jobs.length > 0 ? (
                <div className="space-y-4">
                  {jobs.map((job) => (
                    <div key={job.id} className="p-4 rounded-xl bg-background/40 border border-border/50 hover:border-primary/50 transition-all group">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h4 className="font-bold group-hover:text-primary transition-colors">{job.name}</h4>
                          <p className="text-xs text-muted-foreground line-clamp-1">{job.description}</p>
                        </div>
                        <Badge variant={job.status === 'dokončená' || job.status === 'fakturována' ? 'default' : 'outline'}>
                          {job.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {job.startDate || '-'}</span>
                        <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" /> {job.budget?.toLocaleString()} Kč</span>
                        <Link href={`/portal/jobs/${job.id}`} className="ml-auto text-primary hover:underline flex items-center gap-1">
                          Zobrazit detail <ChevronLeft className="w-3 h-3 rotate-180" />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                  <Briefcase className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p>Zatím nemáte žádné zakázky.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <History className="w-5 h-5 text-primary" /> Poslední aktivita
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div>
                    <p className="font-semibold">Zákazník vytvořen v systému</p>
                    <p className="text-xs text-muted-foreground">
                      {customer.createdAt?.toDate ? customer.createdAt.toDate().toLocaleString('cs-CZ') : '-'}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={Boolean(transferPhotoId)} onOpenChange={(o) => !o && setTransferPhotoId(null)}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Převést foto zaměření k zakázce</DialogTitle>
            <DialogDescription>
              Vyberte zakázku tohoto zákazníka. Fotografie včetně anotací se zobrazí v detailu zakázky.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="text-sm font-medium" htmlFor="cust-mp-job">
              Zakázka
            </label>
            <select
              id="cust-mp-job"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={transferJobId}
              onChange={(e) => setTransferJobId(e.target.value)}
            >
              <option value="">— vyberte —</option>
              {(jobs ?? []).filter((j: { id?: string }) => j.id).map((j: { id: string; name?: string }) => (
                <option key={j.id} value={j.id}>
                  {j.name || j.id}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setTransferPhotoId(null)}>
              Zrušit
            </Button>
            <Button
              type="button"
              disabled={transferSaving || !transferJobId.trim()}
              onClick={() => void handleTransferMeasurementPhotoToJob()}
            >
              {transferSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Přiřadit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={portalDialogOpen} onOpenChange={setPortalDialogOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
          <form onSubmit={handleCreatePortalAccount}>
            <DialogHeader>
              <DialogTitle>Vytvořit klientský účet</DialogTitle>
              <DialogDescription>
                Vytvoří se záznam ve Firebase Authentication a profil <code className="text-xs">users/&#123;uid&#125;</code> s rolí{' '}
                <code className="text-xs">customer</code>. Zadejte počáteční heslo; zákazníkovi ho předejte bezpečným kanálem (heslo se nikde
                neukládá ani nezobrazuje).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="portal-email">E-mail přihlášení</Label>
                <Input
                  id="portal-email"
                  type="email"
                  autoComplete="off"
                  value={portalEmail}
                  onChange={(e) => setPortalEmail(e.target.value)}
                  placeholder="zákazník@firma.cz"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="portal-pw">Počáteční heslo</Label>
                <Input
                  id="portal-pw"
                  type="password"
                  autoComplete="new-password"
                  value={portalPassword}
                  onChange={(e) => setPortalPassword(e.target.value)}
                  minLength={MIN_EMPLOYEE_PASSWORD_LENGTH}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="portal-pw2">Potvrzení hesla</Label>
                <Input
                  id="portal-pw2"
                  type="password"
                  autoComplete="new-password"
                  value={portalPassword2}
                  onChange={(e) => setPortalPassword2(e.target.value)}
                  minLength={MIN_EMPLOYEE_PASSWORD_LENGTH}
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setPortalDialogOpen(false)}>
                Zrušit
              </Button>
              <Button type="submit" disabled={portalSubmitting}>
                {portalSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Vytvořit účet'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={resetLinkDialogOpen} onOpenChange={setResetLinkDialogOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Odkaz pro obnovení hesla</DialogTitle>
            <DialogDescription>
              Odkaz předejte zákazníkovi (např. e-mailem). Platnost je omezená. Firebase e-mail automaticky neodesílá — záleží na vašem procesu.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="reset-link-field">Odkaz</Label>
            <textarea
              id="reset-link-field"
              readOnly
              className="flex min-h-[80px] w-full rounded-md border border-input bg-muted/40 px-3 py-2 text-xs font-mono"
              value={resetLinkValue}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setResetLinkDialogOpen(false)}>
              Zavřít
            </Button>
            <Button type="button" className="gap-2" onClick={() => void copyResetLink()}>
              <Copy className="w-4 h-4" />
              Zkopírovat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
