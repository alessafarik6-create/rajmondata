
"use client";

import React from 'react';
import { 
  Users, 
  Briefcase, 
  Clock, 
  Wallet,
  Calendar,
  Activity
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection } from 'firebase/firestore';

export default function CompanyDashboard() {
  const { user } = useUser();
  const firestore = useFirestore();

  // Získání profilu uživatele pro detekci organizace
  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);

  // V reálné aplikaci by ID organizace bylo uloženo v profilu uživatele
  // Pro účely prototypu a multi-tenant struktury použijeme ID z profilu nebo fallback
  const companyId = profile?.companyId || 'nebula-tech'; 

  // Načtení dat z Firestore subkolekcí pro danou firmu
  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'employees');
  }, [firestore, companyId]);

  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'jobs');
  }, [firestore, companyId]);

  const { data: employees } = useCollection(employeesQuery);
  const { data: jobs, isLoading: isJobsLoading } = useCollection(jobsQuery);

  if (isProfileLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold">Dobré ráno, {profile?.displayName || user?.email?.split('@')[0]}</h1>
          <p className="text-muted-foreground mt-2">Zde je přehled výkonu vaší organizace ({companyId}) pro dnešek.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="gap-2">
            <Calendar className="w-4 h-4" /> Rozvrh
          </Button>
          <Button className="gap-2">
            <Briefcase className="w-4 h-4" /> Nová zakázka
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="bg-surface border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Aktivní zaměstnanci</CardTitle>
            <Users className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{employees?.length || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Celkový počet v {companyId}</p>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Aktivní zakázky</CardTitle>
            <Briefcase className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{jobs?.filter(j => j.status !== 'completed').length || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Probíhající projekty</p>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Dnešní docházka</CardTitle>
            <Clock className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">94%</div>
            <p className="text-xs text-muted-foreground mt-1">Většina týmu je přítomna</p>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Měsíční obrat</CardTitle>
            <Wallet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">12 450 Kč</div>
            <p className="text-xs text-emerald-500 mt-1">+15% oproti min. měsíci</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle>Probíhající projekty</CardTitle>
              <CardDescription>Výkon aktivních zakázek v rámci workspace {companyId}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {isJobsLoading ? (
                <div className="flex justify-center p-8">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : jobs && jobs.length > 0 ? (
                jobs.slice(0, 5).map((job) => (
                  <div key={job.id} className="space-y-2">
                    <div className="flex justify-between items-center">
                      <div>
                        <h4 className="font-semibold">{job.name}</h4>
                        <p className="text-xs text-muted-foreground">{job.status === 'completed' ? 'Dokončeno' : 'Probíhá'}</p>
                      </div>
                      <Badge variant={job.status === 'completed' ? 'default' : 'secondary'} className="capitalize">
                        {job.status === 'completed' ? 'Hotovo' : 'Aktivní'}
                      </Badge>
                    </div>
                    <Progress value={job.status === 'completed' ? 100 : 45} className="flex-1" />
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  Nebyly nalezeny žádné aktivní zakázky pro tuto organizaci.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle>Rychlé akce</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Button variant="outline" className="justify-start w-full">Log docházky týmu</Button>
              <Button variant="outline" className="justify-start w-full">Vytvořit fakturu</Button>
              <Button variant="outline" className="justify-start w-full">Schválit dovolenou</Button>
              <Button variant="outline" className="justify-start w-full">Nahrát firemní dokumenty</Button>
            </CardContent>
          </Card>

          <Card className="bg-surface border-border">
            <CardHeader className="flex flex-row items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              <CardTitle>Poslední aktivita</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { user: 'Sára J.', action: 'Zahájila směnu', time: 'před 5m' },
                { user: 'Michal T.', action: 'Aktualizoval zakázku #23', time: 'před 1h' },
                { user: 'Účetní', action: 'Nahrál nový doklad', time: 'před 3h' },
                { user: 'Systém', action: 'Záloha workspace proběhla', time: 'včera' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <div className="mt-0.5 w-2 h-2 rounded-full bg-primary" />
                  <div>
                    <span className="font-semibold">{item.user}</span> {item.action}
                    <p className="text-xs text-muted-foreground mt-0.5">{item.time}</p>
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
