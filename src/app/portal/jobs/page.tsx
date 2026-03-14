
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { User, Plus, Loader2, Briefcase, Search, Filter, Calendar, Building2 } from "lucide-react";
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';

export default function JobsPage() {
  const { user } = userUser(); // V opraveném kódu by mělo být useUser()
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);

  const companyId = profile?.companyId || 'nebula-tech'; 
  const isAdmin = profile?.role === 'owner' || profile?.role === 'admin' || profile?.globalRoles?.includes('super_admin');

  // Načtení zákazníků pro výběr
  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'customers');
  }, [firestore, companyId]);
  const { data: customers } = useCollection(customersQuery);

  // Načtení zakázek
  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'jobs');
  }, [firestore, companyId]);

  const { data: allJobs, isLoading } = useCollection(jobsQuery);

  const jobs = isAdmin ? allJobs : allJobs?.filter(j => j.assignedEmployeeIds?.includes(user?.uid));

  const [isNewJobOpen, setIsNewJobOpen] = useState(false);
  const [newJob, setNewJob] = useState({
    name: '',
    description: '',
    customerId: '',
    status: 'nová',
    budget: '',
    startDate: '',
    endDate: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !user) return;
    setIsSubmitting(true);

    try {
      const colRef = collection(firestore, 'companies', companyId, 'jobs');
      await addDoc(colRef, {
        ...newJob,
        budget: Number(newJob.budget),
        companyId,
        assignedEmployeeIds: [user.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      toast({
        title: "Zakázka vytvořena",
        description: `Zakázka "${newJob.name}" byla úspěšně přidána.`
      });
      setIsNewJobOpen(false);
      setNewJob({ name: '', description: '', customerId: '', status: 'nová', budget: '', startDate: '', endDate: '' });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba", description: "Nepodařilo se vytvořit zakázku." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statuses: Record<string, { label: string, variant: "default" | "secondary" | "outline" | "destructive" }> = {
      'nová': { label: 'Nová', variant: 'outline' },
      'rozpracovaná': { label: 'Rozpracovaná', variant: 'secondary' },
      'čeká': { label: 'Čeká', variant: 'outline' },
      'dokončená': { label: 'Dokončená', variant: 'default' },
      'fakturována': { label: 'Fakturována', variant: 'default' }
    };
    const s = statuses[status] || { label: status, variant: 'outline' };
    return <Badge variant={s.variant} className="capitalize">{s.label}</Badge>;
  };

  const getCustomerName = (id: string) => {
    const customer = customers?.find(c => c.id === id);
    return customer ? (customer.companyName || `${customer.firstName} ${customer.lastName}`) : 'Neznámý zákazník';
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold">Zakázky a Projekty</h1>
          <p className="text-muted-foreground mt-2">Správa firemních projektů v rámci {companyId}.</p>
        </div>
        {isAdmin && (
          <Dialog open={isNewJobOpen} onOpenChange={setIsNewJobOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 shadow-lg shadow-primary/20">
                <Plus className="w-4 h-4" /> Nová zakázka
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-surface border-border max-w-2xl">
              <DialogHeader>
                <DialogTitle>Vytvořit novou zakázku</DialogTitle>
                <DialogDescription>Zadejte základní informace o novém projektu.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateJob} className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-2">
                    <Label htmlFor="name">Název zakázky</Label>
                    <Input 
                      id="name" 
                      required 
                      value={newJob.name} 
                      onChange={e => setNewJob({...newJob, name: e.target.value})}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label htmlFor="description">Popis</Label>
                    <Textarea 
                      id="description" 
                      value={newJob.description} 
                      onChange={e => setNewJob({...newJob, description: e.target.value})}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Zákazník</Label>
                    <Select value={newJob.customerId} onValueChange={v => setNewJob({...newJob, customerId: v})}>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Vyberte zákazníka" />
                      </SelectTrigger>
                      <SelectContent className="bg-surface border-border">
                        {customers?.length ? (
                          customers.map(c => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.companyName || `${c.firstName} ${c.lastName}`}
                            </SelectItem>
                          ))
                        ) : (
                          <div className="p-2 text-xs text-center text-muted-foreground">
                            Žádní zákazníci nenalezeni. <Link href="/portal/customers" className="text-primary hover:underline">Vytvořit?</Link>
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="budget">Rozpočet (Kč)</Label>
                    <Input 
                      id="budget" 
                      type="number"
                      value={newJob.budget} 
                      onChange={e => setNewJob({...newJob, budget: e.target.value})}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="startDate">Termín zahájení</Label>
                    <Input 
                      id="startDate" 
                      type="date"
                      value={newJob.startDate} 
                      onChange={e => setNewJob({...newJob, startDate: e.target.value})}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="endDate">Předpokládané dokončení</Label>
                    <Input 
                      id="endDate" 
                      type="date"
                      value={newJob.endDate} 
                      onChange={e => setNewJob({...newJob, endDate: e.target.value})}
                      className="bg-background"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={isSubmitting} className="w-full">
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Vytvořit zakázku"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="bg-surface border-border">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : jobs && jobs.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="pl-6">Zakázka</TableHead>
                  <TableHead>Zákazník</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead>Termíny</TableHead>
                  <TableHead className="pr-6 text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id} className="border-border hover:bg-muted/30">
                    <TableCell className="pl-6 font-medium">
                      <div className="flex flex-col">
                        <span>{job.name}</span>
                        <span className="text-xs text-muted-foreground font-normal truncate max-w-xs">{job.description}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm">
                        <Building2 className="w-3 h-3 text-muted-foreground" />
                        {getCustomerName(job.customerId)}
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(job.status)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col text-xs">
                        <span className="flex items-center gap-1 text-muted-foreground"><Calendar className="w-3 h-3" /> Od: {job.startDate || '-'}</span>
                        <span className="flex items-center gap-1 font-medium"><Calendar className="w-3 h-3" /> Do: {job.endDate || '-'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <Link href={`/portal/jobs/${job.id}`}>
                        <Button variant="ghost" size="sm">Detaily</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-20 text-muted-foreground">
              <Briefcase className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>Nebyly nalezeny žádné zakázky.</p>
              {isAdmin && <Button variant="link" onClick={() => setIsNewJobOpen(true)}>Vytvořit první projekt</Button>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useUser as userUser } from '@/firebase'; // Oprava pro typo v předchozí iteraci
