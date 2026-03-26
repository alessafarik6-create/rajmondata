"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, Building2 } from "lucide-react";
import type { LicenseConfig } from "@/lib/license-modules";

type Company = {
  id: string;
  name: string;
  isActive: boolean;
  licenseId: string;
  license: LicenseConfig;
};

export default function AdminLicensesPage() {
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Licence</h1>
        <p className="text-slate-800 mt-1">
          Přehled licencí a povolených modulů u organizací. Úpravy proveďte v sekci Organizace.
        </p>
      </div>

      <Card className="border-slate-200 bg-white">
        <CardHeader>
          <CardTitle className="text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" /> Přehled licencí
          </CardTitle>
          <p className="text-sm text-slate-800">
            Kliknutím na organizaci v sekci Organizace můžete měnit typ licence, stav a povolené moduly.
          </p>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="p-4 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm">
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
                  <TableHead className="text-slate-700">Typ licence</TableHead>
                  <TableHead className="text-slate-700">Stav licence</TableHead>
                  <TableHead className="text-slate-700">Moduly</TableHead>
                  <TableHead className="text-right text-slate-700">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((c) => (
                  <TableRow key={c.id} className="border-slate-200 hover:bg-slate-50">
                    <TableCell className="font-medium text-slate-900">{c.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {c.license?.licenseType || c.licenseId || "starter"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.license?.status === "active" ? "default" : "secondary"}>
                        {c.license?.status || "active"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-slate-800">
                        {c.license?.enabledModules?.length ?? 0} modulů
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href="/admin/companies">
                        <Button variant="ghost" size="sm">Upravit</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-slate-800 text-center py-8">Žádné organizace.</p>
          )}
          <div className="mt-4">
            <Link href="/admin/companies">
              <Button variant="outline" className="gap-2">
                <Building2 className="w-4 h-4" /> Správa organizací
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
