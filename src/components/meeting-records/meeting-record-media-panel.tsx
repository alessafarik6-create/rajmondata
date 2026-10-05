"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, updateDoc } from "firebase/firestore";
import { Loader2, Mic, Sparkles, FileText, Trash2, Pencil } from "lucide-react";
import { useUser, useFirestore } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useMeetingAudioRecorder } from "@/hooks/use-meeting-audio-recorder";
import { MeetingAiTaskConfirmDialog } from "@/components/meeting-records/meeting-ai-task-confirm-dialog";
import type {
  MeetingAiSummaryMeta,
  MeetingAiSuggestedTask,
  MeetingAiSummaryStructured,
  MeetingAudioMeta,
  MeetingTranscriptMeta,
} from "@/lib/meeting-records-media-types";

type Props = {
  companyId: string;
  recordId: string;
  canEdit: boolean;
  audio?: MeetingAudioMeta | null;
  transcript?: MeetingTranscriptMeta | null;
  aiSummary?: MeetingAiSummaryMeta | null;
  customerFacingNotes?: string | null;
  onReload: () => void;
  userDisplayName?: string;
  jobId?: string | null;
};

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function StructuredSummaryView({ s }: { s: MeetingAiSummaryStructured }) {
  const block = (title: string, items: string[]) =>
    items.length ? (
      <div>
        <p className="text-xs font-semibold uppercase text-muted-foreground">{title}</p>
        <ul className="list-disc pl-5 text-sm space-y-1">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-xs font-semibold uppercase text-muted-foreground">Souhrn</p>
        <p className="whitespace-pre-wrap">{s.shortSummary}</p>
      </div>
      {block("Klíčové body", s.mainPoints)}
      {block("Rozhodnutí", s.agreed)}
      {block("Úkoly", s.tasks)}
      {block("Termíny", s.deadlines)}
      {block("Otevřené otázky", s.openQuestions)}
      {block("Co je potřeba dořešit", s.doNotForget)}
      {s.nextSteps.length ? (
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Další kroky</p>
          <ol className="list-decimal pl-5 space-y-1">
            {s.nextSteps.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {s.uncertainNotes?.length ? block("Nejasné / ke kontrole", s.uncertainNotes) : null}
    </div>
  );
}

export function MeetingRecordMediaPanel({
  companyId,
  recordId,
  canEdit,
  audio,
  transcript,
  aiSummary,
  customerFacingNotes,
  onReload,
  userDisplayName,
  jobId,
}: Props) {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskDraft, setTaskDraft] = useState<MeetingAiSuggestedTask | null>(null);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);

  const tasks = useMemo(
    () => aiSummary?.suggestedActions?.tasks ?? [],
    [aiSummary?.suggestedActions?.tasks]
  );

  const recorder = useMeetingAudioRecorder({
    user,
    companyId,
    recordId,
    userDisplayName,
    onError: (m) => toast({ variant: "destructive", title: "Audio záznam", description: m }),
    onFinished: () => {
      toast({ title: "Nahrávka byla uložena." });
      onReload();
    },
  });

  useEffect(() => {
    if (!recorder.isActive) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [recorder.isActive]);

  useEffect(() => {
    if (!firestore || !companyId) return;
    void (async () => {
      const { getDocs } = await import("firebase/firestore");
      const snap = await getDocs(collection(firestore, "companies", companyId, "employees"));
      setEmployees(
        snap.docs.map((d) => {
          const data = d.data();
          const name =
            `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim() || String(d.id);
          return { id: d.id, name };
        })
      );
    })();
  }, [firestore, companyId]);

  const loadPlayUrl = useCallback(async () => {
    if (!user || audio?.status !== "ready") return;
    const token = await user.getIdToken();
    const res = await fetch(
      `/api/company/meeting-records/${encodeURIComponent(recordId)}/audio/play-url?companyId=${encodeURIComponent(companyId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (data.ok) setPlayUrl(data.url);
  }, [user, audio?.status, recordId, companyId]);

  const processingLabel = useMemo(() => {
    if (recorder.phase === "recording" || recorder.phase === "paused") return "Nahrávání…";
    if (recorder.phase === "uploading") return "Nahrávka se ukládá…";
    if (audio?.status === "recording") return "Nahrávání…";
    if (transcript?.status === "processing") return "Přepisuji audio…";
    if (aiSummary?.status === "processing") return "Vytvářím AI zápis…";
    if (transcript?.status === "failed") return "Přepis se nepodařil";
    if (aiSummary?.status === "failed") return "AI zápis se nepodařil";
    if (aiSummary?.status === "ready") return "Hotovo";
    if (audio?.status === "ready" && transcript?.status === "ready") return "Připraveno k AI zápisu";
    if (audio?.status === "ready") return "Nahrávka uložena";
    return null;
  }, [recorder.phase, audio?.status, transcript?.status, aiSummary?.status]);

  async function runProcess() {
    if (!user) return;
    setBusy("process");
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
      toast({
        variant: data.ok ? "default" : "destructive",
        title: "AI zpracování",
        description: data.ok ? "Zápis je hotový." : data.error,
      });
      onReload();
    } finally {
      setBusy(null);
    }
  }

  async function retryTranscribe() {
    if (!user) return;
    setBusy("transcribe");
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/meeting-records/${encodeURIComponent(recordId)}/audio/transcribe`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ companyId }),
        }
      );
      const data = await res.json();
      toast({ variant: data.ok ? "default" : "destructive", title: "Přepis", description: data.error ?? "Hotovo." });
      onReload();
    } finally {
      setBusy(null);
    }
  }

  async function deleteAudio() {
    if (!user || !window.confirm("Smazat audio nahrávku? Písemný záznam zůstane.")) return;
    setBusy("delete");
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/meeting-records/${encodeURIComponent(recordId)}/audio/delete`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ companyId }),
        }
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setPlayUrl(null);
      toast({ title: "Audio smazáno" });
      onReload();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Smazání",
        description: e instanceof Error ? e.message : "Selhalo.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function createCustomerVersion() {
    if (!user) return;
    setBusy("customer");
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/meeting-records/${encodeURIComponent(recordId)}/customer-summary`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ companyId }),
        }
      );
      const data = await res.json();
      toast({
        variant: data.ok ? "default" : "destructive",
        title: "Zápis pro zákazníka",
        description: data.ok ? "Verze vytvořena — zkontrolujte před odesláním." : data.error,
      });
      onReload();
    } finally {
      setBusy(null);
    }
  }

  async function saveNotesEdit() {
    if (!firestore || !user) return;
    setBusy("save");
    try {
      await updateDoc(doc(firestore, "companies", companyId, "meetingRecords", recordId), {
        meetingNotes: notesDraft,
      });
      setEditNotes(false);
      toast({ title: "Zápis uložen" });
      onReload();
    } finally {
      setBusy(null);
    }
  }

  async function confirmCreateTask(payload: { title: string; employeeId: string; dueDate: string }) {
    if (!user) return;
    const token = await user.getIdToken();
    const res = await fetch(
      `/api/company/meeting-records/${encodeURIComponent(recordId)}/create-task-from-ai`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          title: payload.title,
          employeeId: payload.employeeId || undefined,
          dueDate: payload.dueDate || undefined,
          jobId: jobId ?? undefined,
        }),
      }
    );
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    toast({ title: "Úkol vytvořen" });
    setTaskDialogOpen(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
        {audio?.status === "ready" ? (
          <span className="rounded-full px-2 py-0.5 border border-emerald-500/40 bg-emerald-50 text-emerald-800">
            🎙 Audio
          </span>
        ) : null}
        {aiSummary?.status === "ready" ? (
          <span className="rounded-full px-2 py-0.5 border border-violet-500/40 bg-violet-50 text-violet-900">
            ✨ AI zpracováno
          </span>
        ) : null}
        {processingLabel ? (
          <span className="rounded-full px-2 py-0.5 border bg-muted text-muted-foreground">
            {processingLabel}
          </span>
        ) : null}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Mic className="h-4 w-4" /> Audio nahrávka
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!audio && recorder.phase === "idle" && canEdit ? (
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                if (
                  !window.confirm(
                    "Spustit další audio záznam k tomuto dokumentu? Ujistěte se o souhlasu účastníků."
                  )
                ) {
                  return;
                }
                void recorder.start(recordId);
              }}
            >
              🎙 Spustit nahrávání
            </Button>
          ) : null}

          {recorder.phase !== "idle" ? (
            <div className="rounded-lg border-2 border-red-500/30 p-4 space-y-2">
              <p className="font-semibold text-red-800">
                {recorder.phase === "recording" ? "● NAHRÁVÁNÍ" : recorder.phase === "paused" ? "⏸ Pozastaveno" : "Ukládám…"}
              </p>
              <p className="text-2xl font-mono">{recorder.formatElapsed()}</p>
              <div className="flex flex-wrap gap-2">
                {recorder.phase === "recording" ? (
                  <Button variant="outline" size="sm" onClick={() => recorder.pause()}>
                    Pozastavit
                  </Button>
                ) : null}
                {recorder.phase === "paused" ? (
                  <Button variant="outline" size="sm" onClick={() => recorder.resume()}>
                    Pokračovat
                  </Button>
                ) : null}
                {(recorder.phase === "recording" || recorder.phase === "paused") && (
                  <Button variant="destructive" size="sm" onClick={() => void recorder.stop()}>
                    Ukončit nahrávání
                  </Button>
                )}
              </div>
            </div>
          ) : null}

          {audio?.status === "ready" ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Délka: {formatDuration(audio.durationSeconds ?? 0)}
                {audio.recordedByName ? ` · ${audio.recordedByName}` : ""}
              </p>
              {playUrl ? (
                <audio controls className="w-full" src={playUrl} preload="metadata" />
              ) : (
                <Button variant="outline" size="sm" onClick={() => void loadPlayUrl()}>
                  ▶ Načíst přehrávač
                </Button>
              )}
              {canEdit ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy === "process"} onClick={() => void runProcess()}>
                    {busy === "process" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    ✨ Zpracovat pomocí AI
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy === "delete"}
                    onClick={() => void deleteAudio()}
                  >
                    <Trash2 className="h-4 w-4" /> Smazat audio
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {transcript?.status === "failed" && canEdit ? (
            <Button size="sm" variant="outline" onClick={() => void retryTranscribe()}>
              Zkusit přepis znovu
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {transcript?.text ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> Přepis schůzky
            </CardTitle>
          </CardHeader>
          <CardContent>
            <details>
              <summary className="cursor-pointer text-sm text-primary">Zobrazit přepis</summary>
              <pre className="mt-2 whitespace-pre-wrap text-sm max-h-96 overflow-auto border rounded-md p-3 bg-muted/20">
                {transcript.text}
              </pre>
            </details>
          </CardContent>
        </Card>
      ) : null}

      {aiSummary?.structured ? (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> AI zápis
            </CardTitle>
            {canEdit ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setNotesDraft(aiSummary.markdown ?? "");
                  setEditNotes((v) => !v);
                }}
              >
                <Pencil className="h-4 w-4" /> Upravit
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {editNotes ? (
              <div className="space-y-2">
                <Textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} rows={12} />
                <Button size="sm" disabled={busy === "save"} onClick={() => void saveNotesEdit()}>
                  Uložit úpravy
                </Button>
              </div>
            ) : (
              <StructuredSummaryView s={aiSummary.structured} />
            )}
            {canEdit ? (
              <Button variant="outline" size="sm" disabled={busy === "customer"} onClick={() => void createCustomerVersion()}>
                Vytvořit zápis pro zákazníka
              </Button>
            ) : null}
            {customerFacingNotes ? (
              <div className="rounded-md border p-3 bg-slate-50">
                <p className="text-xs font-medium text-muted-foreground mb-1">Verze pro zákazníka</p>
                <pre className="whitespace-pre-wrap text-sm">{customerFacingNotes}</pre>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {tasks.length > 0 && canEdit ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Navržené úkoly</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ul className="space-y-2">
              {tasks.map((t, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 text-sm border rounded-md p-2">
                  <span>
                    {t.title}
                    {t.dueDate ? ` · do ${t.dueDate}` : ""}
                    {t.assignedTo ? ` · ${t.assignedTo}` : ""}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setTaskDraft(t);
                      setTaskDialogOpen(true);
                    }}
                  >
                    Vytvořit úkol
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <MeetingAiTaskConfirmDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        task={taskDraft}
        employees={employees}
        onConfirm={confirmCreateTask}
      />
    </div>
  );
}
