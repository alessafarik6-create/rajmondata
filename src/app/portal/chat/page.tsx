"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Send, MessageSquare } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Týmová komunikace – bez ukázkových kontaktů a zpráv.
 * Konverzace se vytvoří až po napojení na reálné kanály v databázi.
 */
export default function ChatPage() {
  const [draft, setDraft] = useState("");

  return (
    <div className="flex h-[calc(100vh-160px)] gap-6 overflow-hidden">
      <Card className="flex w-80 shrink-0 flex-col border-border bg-surface">
        <div className="border-b p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Hledat zprávy..."
              className="border-border bg-background pl-10"
              disabled
              aria-disabled="true"
            />
          </div>
          <Button variant="outline" className="w-full justify-between" disabled>
            Nová zpráva
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <MessageSquare className="h-10 w-10 opacity-40" />
            <p>Zatím nemáte žádné zprávy.</p>
          </div>
        </ScrollArea>
      </Card>

      <Card className="flex flex-1 flex-col overflow-hidden border-border bg-surface">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <MessageSquare className="h-12 w-12 text-muted-foreground opacity-30" />
          <div className="max-w-md space-y-2">
            <h3 className="text-lg font-semibold text-foreground">Zprávy</h3>
            <p className="text-sm text-muted-foreground">
              Zatím nemáte žádné zprávy.
            </p>
          </div>
        </div>

        <div className="border-t bg-background/30 p-4">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-1 pr-3 shadow-inner">
            <Input
              placeholder="Zprávy budou dostupné po založení konverzace..."
              className="h-10 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled
              aria-label="Pole pro zprávu – zatím neaktivní"
            />
            <Button size="icon" className="h-8 w-8 shrink-0" disabled>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
