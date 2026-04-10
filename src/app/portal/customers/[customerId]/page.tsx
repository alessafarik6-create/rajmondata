
"use client";
import { Loader2 } from "lucide-react";

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, where, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
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
import { Textarea } from '@/components/ui/textarea';
import { MIN_EMPLOYEE_PASSWORD_LENGTH } from '@/lib/employee-password-policy';

type CustomerDisplay = {
  id: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  ico?: string;
  notes?: string;
  createdAt?: { toDate?: () => Date };
};

export default function CustomerDetailPage() {
  const params = useParams();
  const customerId = params?.customerId;
  const router = useRouter();
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const userRef = useMemoFirebase(() => user && firestore ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);
  const companyId = profile?.companyId;

  const customerIdStr =
    typeof customerId === 'string'
      ? customerId
      : Array.isArray(customerId)
        ? customerId[0] ?? ''
        : '';

  const customerRef = useMemoFirebase(
    () =>
      companyId && customerIdStr
        ? doc(firestore, 'companies', companyId, 'customers', customerIdStr)
        : null,
    [firestore, companyId, customerIdStr]
  );
  const { data: customer, isLoading } = useDoc(customerRef);

  // Načtení zakázek tohoto zákazníka
  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !customerIdStr) return null;
    return query(
      collection(firestore, 'companies', companyId, 'jobs'),
      where('customerId', '==', customerIdStr)
    );
  }, [firestore, companyId, customerIdStr]);

  const { data: jobs, isLoading: isJobsLoading } = useCollection(jobsQuery);

  const measurementPhotosQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !customerIdStr) return null;
    return query(
      collection(firestore, 'companies', companyId, 'measurement_photos'),
      where('customerId', '==', customerIdStr)
    );
  }, [firestore, companyId, customerIdStr]);

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

  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [editCompanyName, setEditCompanyName] = useState('');
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editIco, setEditIco] = useState('');
  const [editDic, setEditDic] = useState('');
  const [editNotes, setEditNotes] = useState('');

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

  if (!customerIdStr) {
    return (
      <Alert className="max-w-xl border-slate-200 bg-slate-50">
        <AlertTitle>Neplatná adresa</AlertTitle>
        <AlertDescription>Chybí ID zákazníka v URL.</AlertDescription>
      </Alert>
    );
  }

  const effectiveCustomer = (customer ?? {
    id: customerIdStr,
    companyName: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    notes: '',
  }) as CustomerDisplay;

  const openPortalCreateDialog = () => {
    setPortalEmail(String(effectiveCustomer.email || '').trim());
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
          customerId: customerIdStr,
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
        body: JSON.stringify({ customerId: customerIdStr }),
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
        body: JSON.stringify({ customerId: customerIdStr }),
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
        body: JSON.stringify({ customerId: customerIdStr, enabled }),
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

  const openProfileEdit = () => {
    console.log('[customer profile] Upravit profil clicked', {
      customerIdStr,
      hasFirestoreDoc: Boolean(customer),
    });
    const c = (customer ?? {}) as Record<string, unknown>;
    setEditCompanyName(String(c.companyName ?? ''));
    setEditFirstName(String(c.firstName ?? ''));
    setEditLastName(String(c.lastName ?? ''));
    setEditEmail(String(c.email ?? ''));
    setEditPhone(String(c.phone ?? ''));
    setEditAddress(String(c.address ?? ''));
    setEditIco(String(c.ico ?? ''));
    setEditDic(
      String(c.dic ?? c.DIČ ?? c.DIC ?? c['dič'] ?? '')
    );
    setEditNotes(String(c.notes ?? ''));
    setProfileEditOpen(true);
    console.log('[customer profile] edit dialog open');
  };

  const handleSaveCustomerProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firestore || !companyId || !customerIdStr) return;
    const isNewRecord = customer == null;
    console.log('[customer profile] saving profile', {
      customerIdStr,
      isNewRecord,
    });
    setProfileSaving(true);
    try {
      const ref = doc(
        firestore,
        'companies',
        companyId,
        'customers',
        customerIdStr
      );
      await setDoc(
        ref,
        {
          companyId,
          companyName: editCompanyName.trim(),
          firstName: editFirstName.trim(),
          lastName: editLastName.trim(),
          email: editEmail.trim(),
          phone: editPhone.trim(),
          address: editAddress.trim(),
          ico: editIco.trim(),
          dic: editDic.trim(),
          notes: editNotes.trim(),
          updatedAt: serverTimestamp(),
          ...(isNewRecord ? { createdAt: serverTimestamp() } : {}),
        },
        { merge: true }
      );
      toast({
        title: isNewRecord
          ? 'Profil zákazníka byl vytvořen'
          : 'Profil zákazníka byl upraven',
      });
      setProfileEditOpen(false);
    } catch (err) {
      console.error(err);
      toast({
        variant: 'destructive',
        title: 'Uložení se nezdařilo',
        description:
          err instanceof Error ? err.message : 'Zkuste to prosím znovu.',
      });
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <Button variant="ghost" size="icon" type="button" onClick={() => router.push('/portal/customers')}>
            <ChevronLeft className="w-6 h-6" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="portal-page-title break-words">
              {effectiveCustomer.companyName ||
                `${effectiveCustomer.firstName ?? ''} ${effectiveCustomer.lastName ?? ''}`.trim() ||
                'Zákazník'}
            </h1>
            <p className="text-muted-foreground">Profil zákazníka a historie spolupráce</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:ml-auto">
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer gap-2"
            onClick={openProfileEdit}
          >
            <Edit2 className="w-4 h-4" /> Upravit profil
          </Button>
          <Button type="button" className="gap-2" asChild>
            <Link href="/portal/jobs">
              <Briefcase className="w-4 h-4" /> Nová zakázka
            </Link>
          </Button>
        </div>
      </div>

      {!customer ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-950">
          <AlertTitle>Záznam v CRM zatím neexistuje</AlertTitle>
          <AlertDescription>
            Dokument ve Firestore pro toto ID chybí. Pomocí tlačítka <strong>Upravit profil</strong> můžete údaje
            vyplnit a uložením záznam vytvořit.
          </AlertDescription>
        </Alert>
      ) : null}

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
                  <p className="font-semibold">{effectiveCustomer.companyName || '-'}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <User className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold">Kontaktní osoba</p>
                  <p className="font-semibold">
                    {effectiveCustomer.firstName} {effectiveCustomer.lastName}
                  </p>
                </div>
              </div>
              <Separator className="bg-border/50" />
              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold">Email</p>
                  <p className="font-semibold select-all">{effectiveCustomer.email || '-'}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold">Telefon</p>
                  <p className="font-semibold">{effectiveCustomer.phone || '-'}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold">Adresa</p>
                  <p className="text-sm">{effectiveCustomer.address || '-'}</p>
                </div>
              </div>
              {effectiveCustomer.ico ? (
                <div className="pt-2">
                  <Badge variant="outline" className="font-mono text-[10px] tracking-tighter">IČO: {effectiveCustomer.ico}</Badge>
                </div>
              ) : null}
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
              {!customer ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  Nejprve uložte profil zákazníka (tlačítko <strong>Upravit profil</strong>). Bez záznamu v CRM nelze
                  bezpečně navázat klientský účet.
                </p>
              ) : null}
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
                      {portalEmailStored || effectiveCustomer.email || '—'}
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
                    <Button
                      type="button"
                      className="w-full gap-2"
                      disabled={!customer}
                      onClick={openPortalCreateDialog}
                    >
                      <KeyRound className="w-4 h-4" />
                      Vytvořit přístup do portálu
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full gap-2"
                        disabled={portalActionLoading || !customer}
                        onClick={() => void handleSyncPortalJobs()}
                      >
                        <RefreshCw className="w-4 h-4" />
                        Synchronizovat zakázky do portálu
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full gap-2"
                        disabled={portalActionLoading || !portalEnabled || !customer}
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
                          disabled={portalActionLoading || !customer}
                          onClick={() => void handleSetPortalEnabled(false)}
                        >
                          Deaktivovat přístup
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          className="w-full"
                          disabled={portalActionLoading || !customer}
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
                {effectiveCustomer.notes || 'Žádné interní poznámky.'}
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
                      {effectiveCustomer.createdAt?.toDate
                        ? effectiveCustomer.createdAt.toDate().toLocaleString('cs-CZ')
                        : '-'}
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

      <Dialog
        open={profileEditOpen}
        onOpenChange={(open) => {
          if (!open && profileSaving) return;
          setProfileEditOpen(open);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto bg-white border-slate-200 text-slate-900 sm:max-w-lg">
          <form onSubmit={(e) => void handleSaveCustomerProfile(e)}>
            <DialogHeader>
              <DialogTitle>Upravit profil zákazníka</DialogTitle>
              <DialogDescription>
                Změny se uloží do CRM. Pole mohou zůstat prázdná, pokud údaje neznáte.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cust-edit-company">Název firmy</Label>
                <Input
                  id="cust-edit-company"
                  value={editCompanyName}
                  onChange={(e) => setEditCompanyName(e.target.value)}
                  autoComplete="organization"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-edit-fn">Jméno</Label>
                <Input
                  id="cust-edit-fn"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  autoComplete="given-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-edit-ln">Příjmení</Label>
                <Input
                  id="cust-edit-ln"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  autoComplete="family-name"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cust-edit-email">E-mail</Label>
                <Input
                  id="cust-edit-email"
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cust-edit-phone">Telefon</Label>
                <Input
                  id="cust-edit-phone"
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  autoComplete="tel"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cust-edit-address">Adresa</Label>
                <Input
                  id="cust-edit-address"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  autoComplete="street-address"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cust-edit-ico">IČO</Label>
                <Input
                  id="cust-edit-ico"
                  value={editIco}
                  onChange={(e) => setEditIco(e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cust-edit-dic">DIČ (volitelné)</Label>
                <Input
                  id="cust-edit-dic"
                  value={editDic}
                  onChange={(e) => setEditDic(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cust-edit-notes">Interní poznámka</Label>
                <Textarea
                  id="cust-edit-notes"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={3}
                  className="resize-y"
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                disabled={profileSaving}
                onClick={() => setProfileEditOpen(false)}
              >
                Zrušit
              </Button>
              <Button type="submit" disabled={profileSaving} className="cursor-pointer">
                {profileSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Uložit'
                )}
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
