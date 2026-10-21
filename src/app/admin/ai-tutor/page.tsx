"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AI_TUTORIALS } from "@/lib/ai-tutor/tutorial-registry";

export default function AdminAiTutorPage() {
  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AI učitel — průvodci</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Katalog modulárních průvodců v kódu (<code className="text-xs">src/lib/ai-tutor/tutorial-registry.ts</code>
          ). Kroky portálu pro firmy dál spravujte v{" "}
          <Link href="/admin/onboarding" className="text-primary underline-offset-2 hover:underline">
            Průvodci portálem
          </Link>
          .
        </p>
      </div>
      <div className="space-y-3">
        {AI_TUTORIALS.map((t) => (
          <Card key={t.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span>{t.title}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  v{t.version} · {t.enabled ? "zapnuto" : "vypnuto"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p className="text-muted-foreground">{t.summary}</p>
              <p>
                Modul: {t.moduleId ?? "—"} · přístup: {t.requiredAccess ?? "read"}
              </p>
              <ol className="list-decimal pl-5 space-y-1">
                {t.steps.map((s) => (
                  <li key={s.id}>
                    <span className="font-medium">{s.title}</span>
                    {s.tourTarget ? (
                      <span className="text-muted-foreground"> — data-tour-id={s.tourTarget}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
