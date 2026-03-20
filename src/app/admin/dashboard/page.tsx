"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Building2,
  Users,
  ShieldCheck,
  CreditCard,
  ArrowUpRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { PLATFORM_NAME } from "@/lib/platform-brand";
console.log("projectId", process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
console.log("user", user);
console.log("company", company);
type Company = {
  id: string;
  name: string;
  email?: string;
  isActive: boolean;
  licenseId: string;
  license: { enabledModules?: string[] };
};

export default function AdminDashboardPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    fetch("/api/superadmin/companies")
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data?.error || (r.status === 503 ? "Firebase Admin není nakonfigurován." : "Chyba načtení."));
          return [];
        }
        return r.json();
      })
      .then((data) => setCompanies(Array.isArray(data) ? data : []))
      .catch(() => { setError("Chyba načtení."); setCompanies([]); })
      .finally(() => setLoading(false));
  }, []);

  const activeCount = companies.filter((c) => c.isActive).length;
  const totalLicenses = companies.length;

  const stats = [
    {
      title: "Celkem organizací",
      value: loading ? "—" : String(companies.length),
      icon: Building2,
      change: "+0%",
      positive: true,
    },
    {
      title: "Aktivní organizace",
      value: loading ? "—" : String(activeCount),
      icon: ShieldCheck,
      change: totalLicenses > 0 ? `${Math.round((activeCount / totalLicenses) * 100)}%` : "—",
      positive: true,
    },
    {
      title: "Tarify",
      value: loading ? "—" : "Starter / Pro / Enterprise",
      icon: CreditCard,
      change: "",
      positive: true,
    },
    {
      title: "Správa",
      value: "Organizace",
      icon: Users,
      change: "",
      positive: true,
    },
  ];

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Přehled platformy</h1>
        <p className="text-slate-600 mt-1">
          Vítejte v globální administraci {PLATFORM_NAME}. Zde můžete spravovat organizace a licence.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {stats.map((stat) => (
          <Card key={stat.title} className="border-slate-200 bg-white">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
              {stat.change && (
                <div className="flex items-center text-xs mt-1 text-emerald-500">
                  <ArrowUpRight className="w-3 h-3 mr-1" />
                  {stat.change}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        <Card className="lg:col-span-2 border-slate-200 bg-white">
          <CardHeader>
            <CardTitle className="text-slate-900">Organizace</CardTitle>
            <p className="text-sm text-slate-600">Seznam všech organizací na platformě.</p>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="p-4 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm rounded-t-lg">
                {error}
              </div>
            )}
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : companies.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-slate-700">Organizace</TableHead>
                    <TableHead className="text-slate-700">Tarif</TableHead>
                    <TableHead className="text-slate-700">Stav</TableHead>
                    <TableHead className="text-right text-slate-700">Akce</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companies.slice(0, 10).map((company) => (
                    <TableRow key={company.id} className="border-slate-200 hover:bg-slate-50">
                      <TableCell className="font-medium text-slate-900">{company.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-primary/30 text-primary capitalize">
                          {company.licenseId || "starter"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={company.isActive ? "default" : "secondary"}>
                          {company.isActive ? "Aktivní" : "Neaktivní"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/admin/companies`}>
                          <Button variant="ghost" size="sm">
                            Správa
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-slate-600 text-center py-8">Žádné organizace.</p>
            )}
            <div className="mt-4">
              <Link href="/admin/companies">
                <Button variant="outline" className="w-full sm:w-auto">
                  Zobrazit všechny organizace
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white">
          <CardHeader>
            <CardTitle className="text-slate-900">Rychlé akce</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/admin/companies" className="block">
              <Button variant="outline" className="w-full justify-start gap-2">
                <Building2 className="w-4 h-4" /> Správa organizací
              </Button>
            </Link>
            <Link href="/admin/licenses" className="block">
              <Button variant="outline" className="w-full justify-start gap-2">
                <ShieldCheck className="w-4 h-4" /> Licence
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
