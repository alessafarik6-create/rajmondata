"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ChatMessageDoc } from "@/lib/company-chat-types";

export function ChatJobAssignmentActions(props: {
  companyId: string;
  message: ChatMessageDoc;
  mode: "admin" | "employee";
  mine: boolean;
  getToken: () => Promise<string>;
  onUpdated?: () => void;
}) {
  const m = props.message;
  const jobId = String(m.linkedJobId ?? "").trim();
  const status = m.jobAssignmentStatus ?? null;
  const targetUid = String(m.jobAssignmentTargetUserId ?? m.recipientUserId ?? "").trim();
  const showActions =
    props.mode === "employee" &&
    !props.mine &&
    jobId &&
    targetUid &&
    status === "pending";

  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const jobHref =
    props.mode === "employee"
      ? `/portal/employee/jobs/${encodeURIComponent(jobId)}`
      : `/portal/jobs/${encodeURIComponent(jobId)}`;

  const respond = async (action: "accept" | "decline", reason?: string) => {
    setBusy(action);
    setError(null);
    try {
      const token = await props.getToken();
      const res = await fetch("/api/company/chat/job-assignment-response", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messageId: m.id,
          action,
          declineReason: reason ?? null,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Akce se nezdařila.");
      }
      setDeclineOpen(false);
      props.onUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba");
    } finally {
      setBusy(null);
    }
  };

  if (!jobId) return null;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Link
          href={jobHref}
          className={cn(
            "inline-flex items-center rounded-md px-3 py-1.5 text-xs font-semibold",
            props.mine
              ? "bg-primary-foreground/15 text-primary-foreground underline"
              : "bg-orange-600 text-white hover:bg-orange-700"
          )}
        >
          Otevřít zakázku
          {m.linkedJobName ? `: ${m.linkedJobName}` : ""}
        </Link>

        {showActions ? (
          <>
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={!!busy}
              onClick={() => void respond("accept")}
            >
              {busy === "accept" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Přijmout zakázku"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={!!busy}
              onClick={() => setDeclineOpen(true)}
            >
              Nemohu převzít
            </Button>
          </>
        ) : null}
      </div>

      {status === "accepted" ? (
        <p className="text-[10px] text-emerald-600 font-medium">Zakázka přijata.</p>
      ) : null}
      {status === "declined" ? (
        <p className="text-[10px] text-destructive">
          Odmítnuto
          {m.jobAssignmentDeclineReason ? `: ${m.jobAssignmentDeclineReason}` : ""}
        </p>
      ) : null}
      {error ? <p className="text-[10px] text-destructive">{error}</p> : null}

      <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Důvod odmítnutí</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Proč nemůžete zakázku převzít?</Label>
            <Textarea
              rows={3}
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Např. jsem na jiné zakázce v daném termínu."
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeclineOpen(false)}>
              Zrušit
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy === "decline" || declineReason.trim().length < 3}
              onClick={() => void respond("decline", declineReason.trim())}
            >
              {busy === "decline" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Odeslat odmítnutí"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
