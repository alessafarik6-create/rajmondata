"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ShieldCheck, Loader2, Lock, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function AdminLoginPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const trimmedUsername = username.trim();

    if (!trimmedUsername || !password) {
      setError("Zadejte uživatelské jméno a heslo.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/superadmin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username: trimmedUsername,
          password,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(
          typeof data?.error === "string"
            ? data.error
            : "Přihlášení se nezdařilo."
        );
        return;
      }

      toast({
        title: "Přihlášení úspěšné",
        description: "Vítejte v globální administraci.",
      });

      router.replace("/admin/dashboard");
      router.refresh();
    } catch (err) {
      console.error("[AdminLoginPage] login failed", err);
      setError("Připojení se nezdařilo. Zkuste to znovu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 sm:flex sm:items-center sm:justify-center">
      <div className="mx-auto w-full max-w-md space-y-6">
        <Card className="border-slate-200 bg-white shadow-xl">
          <CardHeader className="space-y-4 pt-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/20">
              <ShieldCheck className="h-10 w-10 text-white" />
            </div>

            <div className="space-y-1">
              <CardTitle className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Globální administrace
              </CardTitle>
              <CardDescription className="text-slate-600">
                Přihlaste se do systémové administrace pomocí uživatelského jména
                a hesla.
              </CardDescription>
            </div>
          </CardHeader>

          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4 pb-8">
              {error ? (
                <Alert variant="destructive" className="text-sm">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <Alert className="border-slate-200 bg-slate-50 text-slate-700">
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  Pokud se na mobilu po přihlášení stránka neobnoví okamžitě,
                  vyčkejte chvíli nebo zkuste stránku znovu načíst.
                </AlertDescription>
              </Alert>

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
                  className="h-11 border-slate-200 bg-white text-slate-900 placeholder:text-slate-400"
                  disabled={loading}
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
                  className="h-11 border-slate-200 bg-white text-slate-900 placeholder:text-slate-400"
                  disabled={loading}
                  required
                />
              </div>

              <Button
                type="submit"
                className="mt-2 h-12 w-full bg-primary text-lg font-semibold text-primary-foreground shadow-lg hover:bg-primary/90"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Přihlašování...
                  </>
                ) : (
                  <>
                    <Lock className="mr-2 h-4 w-4" />
                    Přihlásit do administrace
                  </>
                )}
              </Button>
            </CardContent>
          </form>
        </Card>

        <div className="flex justify-center">
          <a
            href="/login"
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            ← Zpět na přihlášení do portálu
          </a>
        </div>
      </div>
    </div>
  );
}
