
"use client";
import { Loader2 } from "lucide-react";

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
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
  User
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';

export default function CustomerDetailPage() {
  const { customerId } = useParams();
  const router = useRouter();
  const { user } = useUser();
  const firestore = useFirestore();

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);
  const companyId = profile?.companyId || 'nebula-tech';

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

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/portal/customers')}>
          <ChevronLeft className="w-6 h-6" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">{customer.companyName || `${customer.firstName} ${customer.lastName}`}</h1>
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
                  <p>Tento zákazník zatím nemá žádné zakázky.</p>
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
    </div>
  );
}
