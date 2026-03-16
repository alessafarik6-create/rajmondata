"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, Loader2, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

export default function AdminLoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const u = username.trim();
    if (!u || !password) {
      setError("Zadejte uživatelské jméno a heslo.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/superadmin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Přihlášení se nezdařilo.");
        return;
      }
      toast({
        title: "Přihlášení úspěšné",
        description: "Vítejte v globální administraci.",
      });
      router.push("/admin/dashboard");
    } catch {
      setError("Připojení se nezdařilo. Zkuste to znovu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md space-y-6">
        <Card className="bg-white border-slate-200 shadow-xl">
          <CardHeader className="text-center space-y-4 pt-8">
            <div className="mx-auto w-16 h-16 bg-primary rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20">
              <ShieldCheck className="text-white w-10 h-10" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                Globální administrace
              </CardTitle>
              <CardDescription className="text-slate-600">
                Přihlaste se do systémové administrace (uživatelské jméno a heslo).
              </CardDescription>
            </div>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4 pb-8">
              {error && (
                <Alert variant="destructive" className="text-sm">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="username" className="text-slate-700">
                  Uživatelské jméno
                </Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  placeholder="superadmin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 h-11"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-700">
                  Heslo
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 h-11"
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full h-12 text-lg font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg mt-2"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                ) : (
                  <Lock className="w-4 h-4 mr-2" />
                )}
                Přihlásit do administrace
              </Button>
            </CardContent>
          </form>
        </Card>

        <div className="flex justify-center">
          <a
            href="/login"
            className="text-sm text-slate-600 hover:text-slate-900 underline"
          >
            ← Zpět na přihlášení do portálu
          </a>
        </div>
      </div>
    </div>
  );
}
