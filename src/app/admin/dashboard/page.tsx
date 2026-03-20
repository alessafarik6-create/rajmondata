"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Users,
  ShieldCheck,
  CreditCard,
  ArrowUpRight,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PLATFORM_NAME } from "@/lib/platform-brand";

type Company = {
  id: string;
  name: string;
  email?: string;
  isActive: boolean;
  licenseId: string;
  license?: { enabledModules?: string[] };
};

export default function AdminDashboardPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadCompanies = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch("/api/superadmin/companies", {
          cache: "no-store",
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          if (!isMounted) return;

          setError(
            data?.error ||
              (response.status === 503
                ? "Firebase Admin není nakonfigurován."
                : "Chyba načtení.")
          );
          setCompanies([]);
          return;
        }

        const data = await response.json();

        if (!isMounted) return;
        setCompanies(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("[AdminDashboardPage] loadCompanies failed", err);
        if (!isMounted) return;
        setError("Chyba načtení.");
        setCompanies([]);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadCompanies();

    return () => {
      isMounted = false;
    };
  }, []);

  const activeCount = companies.filter((company) => company.isActive).length;
  const totalLicenses = companies.length;

  const stats = [
    {
      title: "Celkem organizací",
      value: loading ? "—" : String(companies.length),
      icon: Building2,
      change: "+0%",
    },
    {
      title: "Aktivní organizace",
      value: loading ? "—" : String(activeCount),
      icon: ShieldCheck,
      change:
        totalLicenses > 0
          ? `${Math.round((activeCount / totalLicenses) * 100)}%`
          : "—",
    },
    {
      title: "Tarify",
      value: loading ? "—" : "Starter / Pro / Enterprise",
      icon: CreditCard,
      change: "",
    },
    {
      title: "Správa",
      value: "Organizace",
      icon: Users,
      change: "",
    },
  ];

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          Přehled platformy
        </h1>
        <p className="mt-1 text-slate-600">
          Vítejte v globální administraci {PLATFORM_NAME}. Zde můžete spravovat
          organizace a licence.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title} className="border-slate-200 bg-white">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">
                {stat.value}
              </div>
              {stat.change ? (
                <div className="mt-1 flex items-center text-xs text-emerald-500">
                  <ArrowUpRight className="mr-1 h-3 w-3" />
                  {stat.change}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
        <Card className="border-slate-200 bg-white lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-slate-900">Organizace</CardTitle>
            <p className="text-sm text-slate-600">
              Seznam všech organizací na platformě.
            </p>
          </CardHeader>

          <CardContent>
            {error ? (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                {error}
              </div>
            ) : null}

            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : companies.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-slate-700">Organizace</TableHead>
                    <TableHead className="text-slate-700">Tarif</TableHead>
                    <TableHead className="text-slate-700">Stav</TableHead>
                    <TableHead className="text-right text-slate-700">
                      Akce
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {companies.slice(0, 10).map((company) => (
                    <TableRow
                      key={company.id}
                      className="border-slate-200 hover:bg-slate-50"
                    >
                      <TableCell className="font-medium text-slate-900">
                        {company.name}
                      </TableCell>

                      <TableCell>
                        <Badge
                          variant="outline"
                          className="capitalize border-primary/30 text-primary"
                        >
                          {company.licenseId || "starter"}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        <Badge
                          variant={company.isActive ? "default" : "secondary"}
                        >
                          {company.isActive ? "Aktivní" : "Neaktivní"}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-right">
                        <Link href="/admin/companies">
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
              <p className="py-8 text-center text-slate-600">
                Žádné organizace.
              </p>
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
                <Building2 className="h-4 w-4" />
                Správa organizací
              </Button>
            </Link>

            <Link href="/admin/licenses" className="block">
              <Button variant="outline" className="w-full justify-start gap-2">
                <ShieldCheck className="h-4 w-4" />
                Licence
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
