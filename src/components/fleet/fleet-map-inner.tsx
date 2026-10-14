"use client";

import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { movementStatusLabel } from "@/lib/fleet/providers/types";
import type { FleetVehicleMovementStatus } from "@/lib/fleet/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type FleetMapVehicleMarker = {
  id: string;
  label: string;
  licensePlate: string;
  lat: number;
  lng: number;
  speedKmh?: number | null;
  driverName?: string | null;
  movementStatus: FleetVehicleMovementStatus;
  lastUpdate?: string | null;
  todayKm?: number | null;
  headingDeg?: number | null;
};

export type FleetMapRoute = {
  points: { lat: number; lng: number; recordedAt?: string | null }[];
  start?: { lat: number; lng: number; label?: string };
  end?: { lat: number; lng: number; label?: string };
};

const TILES = {
  standard: {
    label: "Mapa",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  topo: {
    label: "Topografická",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>, &copy; OpenStreetMap',
  },
} as const;

function statusColor(status: FleetVehicleMovementStatus): string {
  if (status === "moving") return "#ea580c";
  if (status === "offline") return "#374151";
  if (status === "idle" || status === "parked") return "#64748b";
  return "#ea580c";
}

function makeCarIcon(status: FleetVehicleMovementStatus, headingDeg?: number | null) {
  const color = statusColor(status);
  const rot =
    status === "moving" && headingDeg != null && Number.isFinite(headingDeg)
      ? `transform:rotate(${headingDeg}deg);`
      : "";
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};color:white;border-radius:9999px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,.3);${rot}">▲</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

const playheadIcon = L.divIcon({
  className: "",
  html: `<div style="background:#0f172a;color:#fff;border:2px solid #ea580c;border-radius:9999px;width:14px;height:14px;"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function FitBounds({
  markers,
  route,
}: {
  markers: FleetMapVehicleMarker[];
  route?: FleetMapRoute | null;
}) {
  const map = useMap();
  useEffect(() => {
    const pts: L.LatLngExpression[] = [];
    for (const m of markers) {
      if (Number.isFinite(m.lat) && Number.isFinite(m.lng)) pts.push([m.lat, m.lng]);
    }
    if (route?.points?.length) {
      for (const p of route.points) pts.push([p.lat, p.lng]);
    }
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.setView(pts[0]!, 12);
      return;
    }
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 14 });
  }, [map, markers, route]);
  return null;
}

export function FleetMapInner({
  markers,
  route,
  height = "420px",
  className,
  onSelectVehicle,
  selectedVehicleId,
  playheadIndex,
}: {
  markers: FleetMapVehicleMarker[];
  route?: FleetMapRoute | null;
  height?: string;
  className?: string;
  onSelectVehicle?: (id: string) => void;
  selectedVehicleId?: string | null;
  playheadIndex?: number | null;
}) {
  const [layer, setLayer] = useState<keyof typeof TILES>("standard");

  const center = useMemo((): [number, number] => {
    const m = markers[0];
    if (m && Number.isFinite(m.lat)) return [m.lat, m.lng];
    const rp = route?.points?.[0];
    if (rp) return [rp.lat, rp.lng];
    return [49.8175, 15.473];
  }, [markers, route]);

  const line = route?.points?.map((p) => [p.lat, p.lng] as [number, number]) ?? [];
  const playhead =
    playheadIndex != null && route?.points?.[playheadIndex]
      ? route.points[playheadIndex]!
      : null;

  const tile = TILES[layer];

  return (
    <div className={cn("rounded-lg overflow-hidden border relative", className)} style={{ height }}>
      <div className="absolute z-[1000] top-2 right-2 flex gap-1">
        {(Object.keys(TILES) as (keyof typeof TILES)[]).map((key) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={layer === key ? "default" : "secondary"}
            className="h-8 text-xs shadow"
            onClick={() => setLayer(key)}
          >
            {TILES[key].label}
          </Button>
        ))}
      </div>
      <MapContainer center={center} zoom={8} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <TileLayer attribution={tile.attribution} url={tile.url} />
        <FitBounds markers={markers} route={route} />
        {line.length > 1 ? (
          <Polyline positions={line} pathOptions={{ color: "#ea580c", weight: 4, opacity: 0.85 }} />
        ) : null}
        {playhead ? <Marker position={[playhead.lat, playhead.lng]} icon={playheadIcon} /> : null}
        {route?.start ? (
          <Marker position={[route.start.lat, route.start.lng]}>
            <Popup>START {route.start.label ?? ""}</Popup>
          </Marker>
        ) : null}
        {route?.end ? (
          <Marker position={[route.end.lat, route.end.lng]}>
            <Popup>CÍL {route.end.label ?? ""}</Popup>
          </Marker>
        ) : null}
        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.lat, m.lng]}
            icon={makeCarIcon(m.movementStatus, m.headingDeg)}
            eventHandlers={{
              click: () => onSelectVehicle?.(m.id),
            }}
            opacity={selectedVehicleId && selectedVehicleId !== m.id ? 0.55 : 1}
          >
            <Popup>
              <div className="text-sm space-y-1 min-w-[180px]">
                <p className="font-semibold uppercase">
                  {m.label} – {m.licensePlate}
                </p>
                <p>Stav: {movementStatusLabel(m.movementStatus)}</p>
                {m.driverName ? <p>Řidič: {m.driverName}</p> : null}
                {m.speedKmh != null ? <p>Rychlost: {Math.round(m.speedKmh)} km/h</p> : null}
                {m.lastUpdate ? (
                  <p className="text-xs text-muted-foreground">
                    Poslední poloha: {new Date(m.lastUpdate).toLocaleString("cs-CZ")}
                  </p>
                ) : null}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
