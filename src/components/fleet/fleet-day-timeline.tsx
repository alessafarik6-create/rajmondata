"use client";

type Segment = {
  kind: "drive" | "stop";
  label: string;
  from: string;
  to?: string | null;
};

export function FleetDayTimeline({ segments }: { segments: Segment[] }) {
  if (!segments.length) {
    return <p className="text-sm text-muted-foreground">Timeline bude dostupná po načtení jízdy z GPS.</p>;
  }
  return (
    <div className="space-y-2">
      {segments.map((s, i) => (
        <div key={i} className="flex gap-3 text-sm">
          <div
            className={
              s.kind === "drive"
                ? "w-2 shrink-0 rounded bg-blue-500"
                : "w-2 shrink-0 rounded bg-amber-500"
            }
          />
          <div>
            <p className="font-medium">{s.kind === "drive" ? "JÍZDA" : "STÁNÍ"} — {s.label}</p>
            <p className="text-muted-foreground text-xs">
              {new Date(s.from).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}
              {s.to
                ? ` – ${new Date(s.to).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
