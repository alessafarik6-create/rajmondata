"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Mic, Sparkles, FileText } from "lucide-react";
import { useUser } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useMeetingAudioRecorder } from "@/hooks/use-meeting-audio-recorder";
import type {
  MeetingAiSummaryMeta,
  MeetingAudioMeta,
  MeetingTranscriptMeta,
  MeetingAiSuggestedTask,
} from "@/lib/meeting-records-media-types";

type Props = {
  companyId: string;
  recordId: string;
  canEdit: boolean;
  audio?: MeetingAudioMeta | null;
  transcript?: MeetingTranscriptMeta | null;
  aiSummary?: MeetingAiSummaryMeta | null;
  onReload: () => void;
  userDisplayName?: string;
};

export function MeetingRecordMediaPanel({
  companyId,
  recordId,
  canEdit,
  audio,
  transcript,
  aiSummary,
  onReload,
  userDisplayName,
}: Props) {
  const { user } = useUser();
  const { toast } = useToast();
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tasks, setTasks] = useState<MeetingAiSuggestedTask[]>(
    aiSummary?.suggestedActions?.tasks ?? []
  );

  useEffect(() => {
    setTasks(aiSummary?.suggestedActions?.tasks ?? []);
  }, [aiSummary]);

  const recorder = useMeetingAudioRecorder({
    user,
    companyId,
    recordId,
    userDisplayName,
    onError: (m) => toast({ variant: "destructive", title: "Audio záznam", description: m }),
    onFinished: () => {
      toast({ title: "Audio záznam uložen" });
      onReload();
    },
  });

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

  async function runTranscribe() {
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
      toast({
        variant: data.ok ? "default" : "destructive",
        title: "AI přepis",
        description: data.ok ? "Přepis je hotový." : data.error,
      });
      onReload();
    } finally {
      setBusy(null);
    }
  }

  async function runSummary() {
    if (!user) return;
    setBusy("summary");
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/meeting-records/${encodeURIComponent(recordId)}/audio/summary`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ companyId }),
        }
      );
      const data = await res.json();
      toast({
        variant: data.ok ? "default" : "destructive",
        title: "AI zápis",
        description: data.ok ? "Zápis vytvořen." : data.error,
      });
      onReload();
    } finally {
      setBusy(null);
    }
  }

  const statusBadges = [
    { label: "Audio", ok: audio?.status === "ready" },
    { label: "Přepis", ok: transcript?.status === "ready" },
    { label: "AI zápis", ok: aiSummary?.status === "ready" },
    { label: "Úkoly", ok: (tasks?.length ?? 0) > 0 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
        {statusBadges.map((b) => (
          <span
            key={b.label}
            className={`rounded-full px-2 py-0.5 border ${b.ok ? "border-emerald-500/40 bg-emerald-50 text-emerald-800" : "border-muted text-muted-foreground"}`}
          >
            {b.ok ? "✅" : "○"} {b.label}
          </span>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Mic className="h-4 w-4" /> Audio záznam
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {recorder.phase === "idle" && canEdit ? (
            <Button
              className="w-full sm:w-auto"
              onClick={() => {
                if (
                  !window.confirm(
                    "Spustit audio záznam schůzky? Nahrávání bude aktivní, dokud ho neukončíte."
                  )
                ) {
                  return;
                }
                void recorder.start();
              }}
            >
              🎙 Audio záznam
            </Button>
          ) : null}

          {recorder.phase !== "idle" ? (
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-medium">
                {recorder.phase === "recording" ? "● Nahrávání" : recorder.phase === "paused" ? "⏸ Pozastaveno" : "…"}
              </p>
              <p className="text-2xl font-mono tabular-nums">{recorder.formatElapsed()}</p>
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
                    Ukončit záznam
                  </Button>
                ) : null}
                {recorder.phase === "uploading" ? (
                  <span className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Ukládám…
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {audio?.status === "ready" ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Délka: {audio.durationSeconds ?? 0} s · {audio.recordedByName ?? "—"}
              </p>
              <Button variant="outline" size="sm" onClick={() => void loadPlayUrl()}>
                ▶ Přehrát
              </Button>
              {playUrl ? <audio controls className="w-full" src={playUrl} /> : null}
              {canEdit ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy === "transcribe"}
                  onClick={() => void runTranscribe()}
                >
                  {busy === "transcribe" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Zpracovat pomocí AI (přepis)
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {transcript?.status === "ready" && transcript.text ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> Přepis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <details>
              <summary className="cursor-pointer text-sm text-primary">Zobrazit celý přepis</summary>
              <pre className="mt-2 whitespace-pre-wrap text-sm max-h-96 overflow-auto">{transcript.text}</pre>
            </details>
            {canEdit ? (
              <Button
                size="sm"
                disabled={busy === "summary"}
                onClick={() => void runSummary()}
              >
                <Sparkles className="h-4 w-4 mr-1" />
                {busy === "summary" ? "Generuji…" : "Vytvořit AI zápis"}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {aiSummary?.status === "ready" && aiSummary.markdown ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> AI zápis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-sm">{aiSummary.markdown}</pre>
          </CardContent>
        </Card>
      ) : null}

      {tasks.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Úkoly a další kroky</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">AI našla {tasks.length} akcí:</p>
            <ul className="space-y-2">
              {tasks.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={t.selected ?? false}
                    onCheckedChange={(v) => {
                      setTasks((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, selected: v === true } : x))
                      );
                    }}
                  />
                  <span>{t.title}</span>
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toast({
                  title: "Úkoly",
                  description:
                    "Označené akce zatím ukládáte ručně — návrhy jsou připraveny k potvrzení.",
                })
              }
            >
              Provést označené
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
