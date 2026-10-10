"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type TaskPick = { id: string; name: string };
type JobPick = { jobId: string; displayLabel: string };
type SafeJobRow = { jobId: string; name?: string; displayLabel?: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceJobId: string;
  tasks: TaskPick[];
  preselectedIds?: string[];
  getToken: () => Promise<string>;
  onCopied: () => void;
};

export function ProductionCopyTasksDialog(props: Props) {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<JobPick[]>([]);
  const [targetJobId, setTargetJobId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setSelected(new Set(props.preselectedIds ?? props.tasks.map((t) => t.id)));
    setLoadingJobs(true);
    void (async () => {
      try {
        const token = await props.getToken();
        const res = await fetch("/api/company/production/team-jobs", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        const list = (Array.isArray(data.jobs) ? data.jobs : []) as SafeJobRow[];
        setJobs(
          list
            .filter((j) => j.jobId && j.jobId !== props.sourceJobId)
            .map((j) => ({
              jobId: j.jobId,
              displayLabel: String(j.displayLabel ?? j.name ?? j.jobId),
            }))
        );
      } catch {
        setJobs([]);
      } finally {
        setLoadingJobs(false);
      }
    })();
  }, [props.open, props.sourceJobId, props.tasks, props.preselectedIds, props.getToken]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!targetJobId || selected.size === 0) return;
    setBusy(true);
    try {
      const token = await props.getToken();
      const res = await fetch("/api/company/production/tasks/copy", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourceJobId: props.sourceJobId,
          targetJobId,
          taskIds: Array.from(selected),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Kopírování selhalo");
      if (Array.isArray(data.duplicateWarnings) && data.duplicateWarnings.length > 0) {
        toast({
          title: "Úkoly zkopírovány",
          description: `Upozornění: v cílové zakázce už existují podobné názvy: ${data.duplicateWarnings.join(", ")}`,
        });
      } else {
        toast({ title: `Zkopírováno ${data.createdCount ?? 0} úkolů` });
      }
      props.onOpenChange(false);
      props.onCopied();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Kopírovat úkoly do jiné zakázky</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Cílová výrobní zakázka</Label>
            {loadingJobs ? (
              <Loader2 className="h-5 w-5 animate-spin mt-2" />
            ) : (
              <select
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={targetJobId}
                onChange={(e) => setTargetJobId(e.target.value)}
              >
                <option value="">— vyberte —</option>
                {jobs.map((j) => (
                  <option key={j.jobId} value={j.jobId}>
                    {j.displayLabel}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="space-y-2">
            <Label>Úkoly ke kopírování</Label>
            {props.tasks.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggle(t.id)} />
                {t.name}
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" disabled={busy || !targetJobId || selected.size === 0} onClick={() => void submit()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Potvrdit kopírování"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
