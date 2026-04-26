"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc } from "firebase/firestore";
import { useFirestore, useDoc, useMemoFirebase, useUser } from "@/firebase";
import { SUPPORT_TICKETS_COLLECTION } from "@/lib/firestore-collections";
import { SupportChat } from "@/components/portal/support/SupportChat";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

export default function PortalHelpTicketDetailPage() {
  const params = useParams();
  const ticketId = String(params?.ticketId || "").trim();
  const firestore = useFirestore();
  const { user } = useUser();

  const userRef = useMemoFirebase(() => (user && firestore ? doc(firestore, "users", user.uid) : null), [
    firestore,
    user,
  ]);
  const { data: profile } = useDoc(userRef);
  const canUse =
    profile?.role === "owner" ||
    profile?.role === "admin" ||
    profile?.role === "manager" ||
    profile?.role === "accountant";

  const ticketRef = useMemoFirebase(
    () => (firestore && ticketId ? doc(firestore, SUPPORT_TICKETS_COLLECTION, ticketId) : null),
    [firestore, ticketId]
  );
  const { data: ticket, isLoading } = useDoc<Record<string, unknown>>(ticketRef);

  if (!ticketId) {
    return <p className="text-sm text-muted-foreground">Chybí ID ticketu.</p>;
  }

  if (!user) {
    return null;
  }

  if (!canUse) {
    return (
      <p className="text-sm text-muted-foreground">
        Detail dotazu je dostupný vlastníkovi, administrátorovi, manažerovi nebo účetnímu.
      </p>
    );
  }

  if (isLoading && !ticket) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <p className="text-sm text-muted-foreground">
        Ticket neexistuje nebo k němu nemáte přístup.{" "}
        <Link href="/portal/help" className="text-primary underline">
          Zpět na nápovědu
        </Link>
      </p>
    );
  }

  const status = String(ticket.status || "");
  const subject = String(ticket.subject || "");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/portal/help" className="text-sm text-primary underline">
          ← Zpět na nápovědu
        </Link>
        <h1 className="portal-page-title mt-2 text-2xl sm:text-3xl">{subject || "Dotaz na podporu"}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="outline">{status === "open" ? "Otevřené" : status === "answered" ? "Odpovězeno" : "Uzavřené"}</Badge>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Konverzace</CardTitle>
          <CardDescription>Zprávy se aktualizují v reálném čase.</CardDescription>
        </CardHeader>
        <CardContent>
          <SupportChat ticketId={ticketId} mode="organization" ticketStatus={status} />
        </CardContent>
      </Card>
    </div>
  );
}
