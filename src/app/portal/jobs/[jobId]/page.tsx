
"use client";

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Briefcase, 
  Calendar, 
  DollarSign, 
  Users, 
  Clock, 
  ChevronLeft, 
  Edit2, 
  CheckCircle2,
  AlertCircle,
  FileText
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function JobDetailPage() {
  const { jobId } = useParams();
  const router = useRouter();
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);
  const companyId = profile?.companyId || 'nebula-tech';

  const jobRef = useMemoFirebase(() => companyId && jobId ? doc(firestore, 'companies', companyId, 'jobs', jobId as string) : null, [firestore, companyId, jobId]);
  const { data: job, isLoading } = useDoc(jobRef);

  const isAdmin = profile?.role === 'owner' || profile?.role === 'admin' || profile?.globalRoles?.includes('super_admin');

  const handleStatusChange = async (newStatus: string) => {
    if (!jobRef) return;
    try {
      await updateDoc(jobRef, { 
        status: newStatus,
        updatedAt: serverTimestamp()
      });
      toast({ title: "Stav aktualizován", description: `Zakázka je nyní ve stavu: ${newStatus}` });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba", description: "Nepodařilo se změnit stav." });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold">Zakázka nenalezena</h2>
        <Button variant="link" onClick={() => router.push('/portal/jobs')}>Zpět na seznam</Button>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/portal/jobs')}>
          <ChevronLeft className="w-6 h-6" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{job.name}</h1>
            <Badge variant="outline" className="border-primary/30 text-primary">ID: {jobId?.toString().substring(0, 8)}</Badge>
          </div>
          <p className="text-muted-foreground">Detailní přehled projektu</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Select value={job.status} onValueChange={handleStatusChange}>
              <SelectTrigger className="w-[180px] bg-surface">
                <SelectValue placeholder="Změnit stav" />
              </SelectTrigger>
              <SelectContent className="bg-surface border-border">
                <SelectItem value="nová">Nová</SelectItem>
                <SelectItem value="rozpracovaná">Rozpracovaná</SelectItem>
                <SelectItem value="čeká">Čeká</SelectItem>
                <SelectItem value="dokončená">Dokončená</SelectItem>
                <SelectItem value="fakturována">Fakturována</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" className="gap-2"><Edit2 className="w-4 h-4" /> Upravit</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" /> Popis zakázky
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-foreground leading-relaxed">
                {job.description || 'K této zakázce nebyl přidán žádný popis.'}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" /> Časová osa a Pokrok
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <div className="flex justify-between text-sm mb-2">
                  <span>Celkový pokrok</span>
                  <span className="font-bold">{job.status === 'dokončená' || job.status === 'fakturována' ? '100%' : '45%'}</span>
                </div>
                <Progress value={job.status === 'dokončená' || job.status === 'fakturována' ? 100 : 45} />
              </div>
              
              <div className="grid grid-cols-2 gap-8 pt-4">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Zahájeno</span>
                  <div className="flex items-center gap-2 font-semibold">
                    <Calendar className="w-4 h-4 text-primary" />
                    {job.startDate || 'neuvedeno'}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Předpokládané dokončení</span>
                  <div className="flex items-center gap-2 font-semibold">
                    <Calendar className="w-4 h-4 text-primary" />
                    {job.endDate || 'neuvedeno'}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" /> Přiřazení pracovníci
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {job.assignedEmployeeIds?.map((empId: string, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border/50">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                        <User className="w-4 h-4" />
                      </div>
                      <span className="font-medium">{empId === user?.uid ? 'Já' : `Pracovník (${empId.substring(0, 5)})`}</span>
                    </div>
                    <Badge variant="outline">Aktivní</Badge>
                  </div>
                ))}
                {!job.assignedEmployeeIds?.length && <p className="text-muted-foreground text-sm">Žádní pracovníci nejsou přiřazeni.</p>}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle>Finanční údaje</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Celkový rozpočet:</span>
                <span className="text-xl font-bold">{job.budget ? `${job.budget.toLocaleString()} Kč` : '-'}</span>
              </div>
              <Separator />
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Vyfakturováno:</span>
                <span className="font-semibold text-emerald-500">{job.status === 'fakturována' ? `${job.budget?.toLocaleString()} Kč` : '0 Kč'}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle>Poznámky a historie</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm space-y-4">
                <div className="flex gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div>
                    <p className="font-semibold">Zakázka vytvořena</p>
                    <p className="text-xs text-muted-foreground">{job.createdAt?.toDate ? job.createdAt.toDate().toLocaleString('cs-CZ') : '-'}</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div>
                    <p className="font-semibold">Stav změněn na "{job.status}"</p>
                    <p className="text-xs text-muted-foreground">{job.updatedAt?.toDate ? job.updatedAt.toDate().toLocaleString('cs-CZ') : '-'}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
