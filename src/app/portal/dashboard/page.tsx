"use client";

import React, { useEffect } from 'react';
import { 
  Users, 
  Briefcase, 
  Clock, 
  Wallet,
  Activity,
  ArrowRight,
  AlertCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection } from 'firebase/firestore';
import Link from 'next/link';

export default function CompanyDashboard() {
  const { user } = useUser();
  const firestore = useFirestore();

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile, isLoading: isProfileLoading, error: profileError } = useDoc(userRef);

  const companyId = profile?.companyId; 
  const role = (profile as { role?: string })?.role || 'employee';

  const isManagement = ['owner', 'admin', 'manager'].includes(role);
  const isAccountant = role === 'accountant';
  const isEmployee = role === 'employee';
  const isCustomer = role === 'customer';

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !isManagement) return null;
    return collection(firestore, 'companies', companyId, 'employees');
  }, [firestore, companyId, isManagement]);

  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'jobs');
  }, [firestore, companyId]);

  const { data: employees, error: employeesError } = useCollection(employeesQuery);
  const { data: allJobs, isLoading: isJobsLoading, error: jobsError } = useCollection(jobsQuery);

  const jobs = allJobs?.filter(j => {
    if (isManagement || isAccountant) return true;
    if (isEmployee && user?.uid) return (j as { assignedEmployeeIds?: string[] }).assignedEmployeeIds?.includes(user.uid);
    if (isCustomer && user?.uid) return (j as { customerId?: string }).customerId === user.uid;
    return false;
  }) ?? [];

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isProfileLoading) {
      if (profileError) {
        console.error('[Dashboard] profile error', profileError);
      } else {
        console.debug('[Dashboard] profile', profile ? { companyId, role, displayName: (profile as { displayName?: string }).displayName } : 'null');
      }
    }
    if (jobsQuery && !isJobsLoading && jobsError) {
      console.error('[Dashboard] jobs error', jobsError);
    } else if (jobsQuery && !isJobsLoading) {
      console.debug('[Dashboard] jobs', allJobs?.length ?? 0);
    }
    if (employeesQuery && employeesError) {
      console.error('[Dashboard] employees error', employeesError);
    }
  }, [isProfileLoading, profile, profileError, companyId, role, jobsQuery, isJobsLoading, allJobs, jobsError, employeesQuery, employeesError]);

  if (isProfileLoading) {
    return (
      <div className="flex items-center justify-center min-h-[320px]" role="status" aria-label="Načítání přehledu">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (profileError) {
    return (
      <Alert variant="destructive" className="max-w-2xl">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Chyba načtení profilu</AlertTitle>
        <AlertDescription>
          {profileError.message}
          <span className="block mt-2 text-xs">Zkuste obnovit stránku nebo se odhlásit a znovu přihlásit.</span>
        </AlertDescription>
      </Alert>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-6 max-w-2xl">
        <h1 className="portal-page-title text-2xl">Přehled</h1>
        <Alert className="border-slate-200 bg-slate-50">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Pracovní prostor se připravuje</AlertTitle>
          <AlertDescription>
            Váš profil nebo firma ještě nejsou v databázi. Měly by se vytvořit automaticky. Počkejte chvíli a obnovte stránku, nebo se odhlaste a přihlaste znovu.
          </AlertDescription>
        </Alert>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium portal-section-label">Tým</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="portal-kpi-value">—</div>
              <p className="portal-kpi-label">Žádná data</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium portal-section-label">Zakázky</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="portal-kpi-value">—</div>
              <p className="portal-kpi-label">Žádná data</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl truncate">Dobré ráno, {profile?.displayName || user?.email?.split('@')[0]}</h1>
          <p className="portal-page-description">
            {isCustomer ? 'Vítejte ve svém klientském portálu.' : `Zde je přehled vaší práce v ${companyId || 'vaší organizaci'}.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {!isCustomer && (
            <Link href="/portal/attendance" className="min-w-[44px]">
              <Button variant="outlineLight" className="gap-2 w-full sm:w-auto min-h-[44px]">
                <Clock className="w-4 h-4 shrink-0" /> <span className="sm:inline">Moje docházka</span>
              </Button>
            </Link>
          )}
          {isManagement && (
            <Link href="/portal/jobs" className="min-w-[44px]">
              <Button className="gap-2 w-full sm:w-auto min-h-[44px]">
                <Briefcase className="w-4 h-4 shrink-0" /> <span className="sm:inline">Nová zakázka</span>
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {isManagement && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium portal-section-label">Tým</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="portal-kpi-value">{employees?.length || 0}</div>
              <p className="portal-kpi-label">Celkový počet pracovníků</p>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium portal-section-label">
              {isCustomer ? 'Moje Zakázky' : 'Aktivní zakázky'}
            </CardTitle>
            <Briefcase className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="portal-kpi-value">{jobs?.filter(j => j.status !== 'dokončená').length || 0}</div>
            <p className="portal-kpi-label">Probíhající projekty</p>
          </CardContent>
        </Card>
        {!isCustomer && (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium portal-section-label">Docházka dnes</CardTitle>
                <Clock className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="portal-kpi-value">94%</div>
                <p className="portal-kpi-label">Většina týmu je přítomna</p>
              </CardContent>
            </Card>
            {(isManagement || isAccountant) && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium portal-section-label">Měsíční obrat</CardTitle>
                  <Wallet className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="portal-kpi-value">12 450 Kč</div>
                  <p className="portal-kpi-label text-emerald-600 font-medium">+15% oproti min. měsíci</p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        <div className="lg:col-span-2 space-y-6 lg:space-y-8 min-w-0">
          <Card>
            <CardHeader>
              <CardTitle>{isCustomer ? 'Stav mých projektů' : 'Sledované projekty'}</CardTitle>
              <CardDescription>Aktuální stav rozpracování zakázek</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {jobsError && (
                <Alert variant="destructive" className="mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>Zakázky se nepodařilo načíst: {jobsError.message}</AlertDescription>
                </Alert>
              )}
              {isJobsLoading && jobsQuery ? (
                <div className="flex justify-center p-8">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-hidden />
                </div>
              ) : jobs && jobs.length > 0 ? (
                jobs.slice(0, 5).map((job) => (
                  <div key={job.id} className="space-y-2">
                    <div className="flex justify-between items-center">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-900">{job.name}</span>
                        <span className="text-[10px] text-slate-600 uppercase font-medium">{job.status}</span>
                      </div>
                      <Link href={`/portal/jobs/${job.id}`}>
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-slate-700">Detail <ArrowRight className="w-3 h-3" /></Button>
                      </Link>
                    </div>
                    <Progress value={job.status === 'dokončená' || job.status === 'fakturována' ? 100 : 45} className="h-1.5" />
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-slate-600">
                  Nebyly nalezeny žádné relevantní zakázky.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:space-y-8 min-w-0">
          {!isCustomer && (
            <Card>
              <CardHeader>
                <CardTitle>Rychlé akce</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <Link href="/portal/attendance">
                  <Button variant="outlineLight" className="justify-start w-full min-h-[44px]">Zapsat příchod/odchod</Button>
                </Link>
                {(isManagement || isAccountant) && (
                  <Link href="/portal/invoices/new">
                    <Button variant="outlineLight" className="justify-start w-full min-h-[44px]">Vytvořit fakturu</Button>
                  </Link>
                )}
                <Link href="/portal/chat">
                  <Button variant="outlineLight" className="justify-start w-full min-h-[44px]">Zprávy týmu</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              <CardTitle>Poslední aktivita</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { user: 'Sára J.', action: 'Zahájila směnu', time: 'před 5m' },
                { user: 'Michal T.', action: 'Aktualizoval zakázku #23', time: 'před 1h' },
                { user: 'Účetní', action: 'Nahrál nový doklad', time: 'před 3h' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <div className="mt-0.5 w-2 h-2 rounded-full bg-primary shrink-0" />
                  <div>
                    <span className="font-semibold text-slate-900">{item.user}</span>
                    <span className="text-slate-700"> {item.action}</span>
                    <p className="text-xs text-slate-500 mt-0.5">{item.time}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}