"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mic } from "lucide-react";
import type { User } from "firebase/auth";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useMeetingAudioRecorder } from "@/hooks/use-meeting-audio-recorder";
import { useIsBelowLg } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

type JobOption = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User;
  companyId: string;
  jobs: JobOption[];
  userDisplayName?: string;
  defaultJobId?: string | null;
};

export function MeetingAudioRecordingDialog(props: Props) {
  const { open, onOpenChange, user, companyId, jobs, userDisplayName, defaultJobId } = props;
  const { toast } = useToast();
  const router = useRouter();
  const belowLg = useIsBelowLg();

  const [title, setTitle] = useState("");
  const [participants, setParticipants] = useState("");
  const [jobId, setJobId] = useState("");
  const [consent, setConsent] = useState(false);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [finished, setFinished] = useState(false);
  const [processingAi, setProcessingAi] = useState(false);

  const recorder = useMeetingAudioRecorder({
    user,
    companyId,
    recordId: recordId ?? "",
    userDisplayName,
    onError: (m) => toast({ variant: "destructive", title: "Nahrávání", description: m }),
    onFinished: () => {
      setFinished(true);
      toast({ title: "Nahrávka byla uložena." });
    },
  });

  useEffect(() => {
    if (!open) {
      setTitle("");
      setParticipants("");
      setJobId(defaultJobId ?? "");
      setConsent(false);
      setRecordId(null);
      setCreating(false);
      setFinished(false);
      setProcessingAi(false);
    }
  }, [open, defaultJobId]);

  useEffect(() => {
    if (!recorder.isActive) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [recorder.isActive]);

  const ensureRecord = useCallback(async (): Promise<string | null> => {
    if (recordId) return recordId;
    setCreating(true);
    try {
      const token = await user.getIdToken();
      const job = jobs.find((j) => j.id === jobId);
      const res = await fetch("/api/company/meeting-records/quick-create", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          meetingTitle: title.trim() || "Audio záznam schůzky",
          participants: participants.trim() || undefined,
          jobId: jobId || undefined,
          jobName: job?.name,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Nepodařilo se vytvořit záznam.");
      setRecordId(data.recordId);
      return data.recordId as string;
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Vytvoření záznamu selhalo.",
      });
      return null;
    } finally {
      setCreating(false);
    }
  }, [recordId, user, companyId, title, participants, jobId, jobs, toast]);

  const startRecording = async () => {
    if (!consent) {
      toast({
        variant: "destructive",
        title: "Souhlas",
        description: "Potvrďte souhlas účastníků s nahráváním.",
      });
      return;
    }
    const id = await ensureRecord();
    if (!id) return;
    setRecordId(id);
    void recorder.start(id);
  };

  const runAiProcess = async () => {
    if (!recordId) return;
    setProcessingAi(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/meeting-records/${encodeURIComponent(recordId)}/audio/process`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ companyId }),
        }
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "AI zpracování selhalo.");
      toast({ title: "AI zápis je hotový" });
      onOpenChange(false);
      router.push(`/portal/meeting-records/${encodeURIComponent(recordId)}`);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "AI zpracování",
        description: e instanceof Error ? e.message : "Selhalo.",
      });
    } finally {
      setProcessingAi(false);
    }
  };

  const handleClose = () => {
    if (recorder.isActive) {
      if (!window.confirm("Probíhá nahrávání. Opravdu zavřít? Nahrávka může být ztracena.")) {
        return;
      }
    }
    onOpenChange(false);
  };

  const formBody = (
    <div className="space-y-4 py-2">
      {!recordId || recorder.phase === "idle" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="mr-audio-title">Název schůzky</Label>
            <Input
              id="mr-audio-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Schůzka – zákazník / téma"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mr-audio-participants">Účastníci (volitelné)</Label>
            <Textarea
              id="mr-audio-participants"
              value={participants}
              onChange={(e) => setParticipants(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label>Zakázka (volitelné)</Label>
            <Select value={jobId || "__none__"} onValueChange={(v) => setJobId(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Nepřiřazeno" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">
            Ujistěte se, že účastníci souhlasí s pořízením audio záznamu.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
            <span>Potvrzuji souhlas účastníků s nahráváním.</span>
          </label>
        </>
      ) : null}

      {recorder.phase !== "idle" && !finished ? (
        <div className="rounded-xl border-2 border-red-500/40 bg-red-50/50 p-4 space-y-3">
          <p className="text-lg font-semibold text-red-800">
            {recorder.phase === "recording" ? "● NAHRÁVÁNÍ" : recorder.phase === "paused" ? "⏸ POZASTAVENO" : "Ukládám…"}
          </p>
          <p className="text-3xl font-mono tabular-nums">{recorder.formatElapsed()}</p>
          <p className="text-sm text-muted-foreground truncate">Schůzka: {title || "—"}</p>
          <div className="flex flex-wrap gap-2">
            {recorder.phase === "recording" ? (
              <Button variant="outline" onClick={() => recorder.pause()}>
                Pozastavit
              </Button>
            ) : null}
            {recorder.phase === "paused" ? (
              <Button variant="outline" onClick={() => recorder.resume()}>
                Pokračovat
              </Button>
            ) : null}
            {recorder.phase === "recording" || recorder.phase === "paused" ? (
              <Button variant="destructive" onClick={() => void recorder.stop()}>
                Ukončit nahrávání
              </Button>
            ) : null}
            {recorder.phase === "uploading" ? (
              <span className="text-sm flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Ukládám nahrávku…
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {finished ? (
        <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="font-medium text-emerald-900">Nahrávka byla uložena.</p>
          <Button
            className="w-full gap-2"
            disabled={processingAi}
            onClick={() => void runAiProcess()}
          >
            {processingAi ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            ✨ Zpracovat pomocí AI
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              if (recordId) router.push(`/portal/meeting-records/${encodeURIComponent(recordId)}`);
              onOpenChange(false);
            }}
          >
            Otevřít detail bez AI
          </Button>
        </div>
      ) : null}
    </div>
  );

  const footer =
    !finished && recorder.phase === "idle" ? (
      <Button
        className="w-full min-h-[48px] gap-2 bg-red-600 hover:bg-red-700"
        disabled={creating || !consent}
        onClick={() => void startRecording()}
      >
        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
        Spustit nahrávání
      </Button>
    ) : null;

  if (belowLg) {
    return (
      <Sheet open={open} onOpenChange={(v) => (v ? onOpenChange(v) : handleClose())}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>Audio záznam schůzky</SheetTitle>
          </SheetHeader>
          {formBody}
          {footer ? <div className="pt-2">{footer}</div> : null}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : handleClose())}>
      <DialogContent className={cn("sm:max-w-md")}>
        <DialogHeader>
          <DialogTitle>Audio záznam schůzky</DialogTitle>
        </DialogHeader>
        {formBody}
        {footer ? <DialogFooter className="sm:justify-stretch">{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
