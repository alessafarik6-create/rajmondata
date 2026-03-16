"use client";

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Loader2, Briefcase, Calendar, Building2, FileStack } from "lucide-react";
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
import type { JobTemplate, JobTemplateValues } from '@/lib/job-templates';
import { JobTemplateFormFields } from '@/components/jobs/job-template-form-fields';

export default function JobsPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);

  const companyId = profile?.companyId || 'nebula-tech'; 
  const isAdmin = profile?.role === 'owner' || profile?.role === 'admin' || profile?.globalRoles?.includes('super_admin');

  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'customers');
  }, [firestore, companyId]);
  const { data: customers } = useCollection(customersQuery);

  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'jobs');
  }, [firestore, companyId]);

  const templatesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'jobTemplates');
  }, [firestore, companyId]);

  const { data: allJobs, isLoading } = useCollection(jobsQuery);
  const { data: templates } = useCollection(templatesQuery);

  const jobs = isAdmin ? allJobs : allJobs?.filter(j => j.assignedEmployeeIds?.includes(user?.uid));

  const searchParams = useSearchParams();
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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [templateValues, setTemplateValues] = useState<JobTemplateValues>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedTemplate = selectedTemplateId ? (templates?.find(t => t.id === selectedTemplateId) as JobTemplate | undefined) : undefined;

  useEffect(() => {
    const tId = searchParams.get('templateId');
    if (tId && templates?.some(t => t.id === tId)) {
      setSelectedTemplateId(tId);
      setIsNewJobOpen(true);
    }
  }, [searchParams, templates]);

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !user) return;
    setIsSubmitting(true);

    try {
      const colRef = collection(firestore, 'companies', companyId, 'jobs');
      const payload: Record<string, unknown> = {
        ...newJob,
        budget: newJob.budget === '' ? 0 : Number(newJob.budget),
        companyId,
        assignedEmployeeIds: [user.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      if (selectedTemplateId) {
        payload.templateId = selectedTemplateId;
        payload.templateValues = templateValues;
      }
      await addDoc(colRef, payload);

      toast({
        title: "Zakázka vytvořena",
        description: `Zakázka "${newJob.name}" byla úspěšně přidána.`
      });
      setIsNewJobOpen(false);
      setNewJob({ name: '', description: '', customerId: '', status: 'nová', budget: '', startDate: '', endDate: '' });
      setSelectedTemplateId('');
      setTemplateValues({});
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
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">Zakázky a Projekty</h1>
          <p className="portal-page-description">Správa firemních projektů v rámci {companyId}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <>
              <Link href="/portal/jobs/templates">
                <Button variant="outlineLight" className="gap-2 min-h-[44px]">
                  <FileStack className="w-4 h-4" /> Šablony
                </Button>
              </Link>
              <Dialog open={isNewJobOpen} onOpenChange={setIsNewJobOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" /> Nová zakázka
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-2xl" data-portal-dialog>
              <DialogHeader>
                <DialogTitle>Vytvořit novou zakázku</DialogTitle>
                <DialogDescription>Zadejte základní informace o novém projektu.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateJob} className="space-y-4 py-4">
                {templates && templates.length > 0 && (
                  <div className="space-y-2">
                    <Label>Šablona (volitelné)</Label>
                    <Select value={selectedTemplateId || 'none'} onValueChange={v => { setSelectedTemplateId(v === 'none' ? '' : v); setTemplateValues({}); }}>
                      <SelectTrigger>
                        <SelectValue placeholder="Bez šablony" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200 text-slate-900">
                        <SelectItem value="none">Bez šablony</SelectItem>
                        {templates.map((t) => (
                          <SelectItem key={t.id} value={t.id!}>
                            {t.name} {t.productType ? `(${t.productType})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-2">
                    <Label htmlFor="name">Název zakázky</Label>
                    <Input 
                      id="name" 
                      required 
                      value={newJob.name} 
                      onChange={e => setNewJob({...newJob, name: e.target.value})}
                      placeholder="Např. Montáž pergoly pro Novákovy"
                    />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label htmlFor="description">Popis</Label>
                    <Textarea 
                      id="description" 
                      value={newJob.description} 
                      onChange={e => setNewJob({...newJob, description: e.target.value})}
                      placeholder="Stručný popis projektu..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Zákazník</Label>
                    <Select value={newJob.customerId} onValueChange={v => setNewJob({...newJob, customerId: v})}>
                      <SelectTrigger>
                        <SelectValue placeholder="Vyberte zákazníka" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200 text-slate-900">
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
                      onChange={e => setNewJob({...newJob, startDate: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="endDate">Předpokládané dokončení</Label>
                    <Input 
                      id="endDate" 
                      type="date"
                      value={newJob.endDate} 
                      onChange={e => setNewJob({...newJob, endDate: e.target.value})}
                    />
                  </div>
                </div>
                {selectedTemplate && (
                  <div className="border-t border-slate-200 pt-4 mt-4">
                    <h4 className="text-sm font-semibold text-slate-700 mb-3">{selectedTemplate.name} – pole šablony</h4>
                    <JobTemplateFormFields
                      template={selectedTemplate as JobTemplate}
                      values={templateValues}
                      onChange={setTemplateValues}
                    />
                  </div>
                )}
                <DialogFooter>
                  <Button type="submit" disabled={isSubmitting} className="w-full">
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Vytvořit zakázku"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center p-8 sm:p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : jobs && jobs.length > 0 ? (
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
                  <TableRow key={job.id} className="border-slate-200 hover:bg-slate-50">
                    <TableCell className="pl-4 sm:pl-6 font-medium text-slate-900">
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{job.name}</span>
                        <span className="text-xs text-slate-600 font-normal truncate max-w-[200px] sm:max-w-xs">{job.description}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-700 hidden md:table-cell">
                      <div className="flex items-center gap-2 text-sm min-w-0">
                        <Building2 className="w-3 h-3 text-slate-500 shrink-0" />
                        <span className="truncate">{getCustomerName(job.customerId)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{getStatusBadge(job.status)}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex flex-col text-xs text-slate-700">
                        <span className="flex items-center gap-1 text-slate-600"><Calendar className="w-3 h-3 shrink-0" /> Od: {job.startDate || '-'}</span>
                        <span className="flex items-center gap-1 font-medium">Do: {job.endDate || '-'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="pr-4 sm:pr-6 text-right">
                      <Link href={`/portal/jobs/${job.id}`}>
                        <Button variant="ghost" size="sm" className="text-slate-700 min-h-[44px] sm:min-h-0">Detaily</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-20 text-slate-600">
              <Briefcase className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>Nebyly nalezeny žádné zakázky.</p>
              {isAdmin && <Button variant="link" className="text-primary" onClick={() => setIsNewJobOpen(true)}>Vytvořit první projekt</Button>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
