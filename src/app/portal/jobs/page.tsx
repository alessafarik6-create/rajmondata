
"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Loader2, Briefcase } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { Progress } from '@/components/ui/progress';

export default function JobsPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  
  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);

  const companyId = profile?.companyId || 'nebula-tech'; 

  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'jobs');
  }, [firestore, companyId]);

  const { data: jobs, isLoading } = useCollection(jobsQuery);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold">Zakázky a Projekty</h1>
          <p className="text-muted-foreground mt-2">Správa firemních projektů ve workspace {companyId}.</p>
        </div>
        <Button className="gap-2">
          <Plus className="w-4 h-4" /> Nová zakázka
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground text-primary">Aktivní zakázky</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{jobs?.filter(j => j.status !== 'completed').length || 0}</div>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Dokončeno</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{jobs?.filter(j => j.status === 'completed').length || 0}</div>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Vytíženost týmu</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">82%</div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-surface border-border">
        <CardHeader className="flex flex-row items-center gap-2">
          <Briefcase className="w-5 h-5 text-primary" />
          <CardTitle>Seznam všech zakázek</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : jobs && jobs.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead>Název zakázky</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead>Pokrok</TableHead>
                  <TableHead>Zahájení</TableHead>
                  <TableHead className="text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id} className="border-border">
                    <TableCell className="font-medium">{job.name}</TableCell>
                    <TableCell>
                      <Badge variant={job.status === 'completed' ? 'default' : 'secondary'} className="capitalize">
                        {job.status === 'completed' ? 'Hotovo' : 'Probíhá'}
                      </Badge>
                    </TableCell>
                    <TableCell className="w-48">
                      <div className="flex items-center gap-2">
                        <Progress value={job.status === 'completed' ? 100 : 45} className="h-1.5" />
                        <span className="text-[10px] text-muted-foreground">{job.status === 'completed' ? '100%' : '45%'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{job.startDate || 'neuvedeno'}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">Otevřít</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-20 text-muted-foreground">
              Nebyly nalezeny žádné zakázky. Začněte vytvořením prvního projektu.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
