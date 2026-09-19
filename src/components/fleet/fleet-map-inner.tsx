"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { movementStatusLabel } from "@/lib/fleet/providers/types";
import type { FleetVehicleMovementStatus } from "@/lib/fleet/types";

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
};

export type FleetMapRoute = {
  points: { lat: number; lng: number }[];
  start?: { lat: number; lng: number; label?: string };
  end?: { lat: number; lng: number; label?: string };
};

const carIcon = L.divIcon({
  className: "",
  html: `<div style="background:#2563eb;color:white;border-radius:9999px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 2px 6px rgba(0,0,0,.25)">🚗</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function FitBounds({ markers, route }: { markers: FleetMapVehicleMarker[]; route?: FleetMapRoute | null }) {
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
  onSelectVehicle,
  selectedVehicleId,
}: {
  markers: FleetMapVehicleMarker[];
  route?: FleetMapRoute | null;
  height?: string;
  onSelectVehicle?: (id: string) => void;
  selectedVehicleId?: string | null;
}) {
  const center = useMemo((): [number, number] => {
    const m = markers[0];
    if (m && Number.isFinite(m.lat)) return [m.lat, m.lng];
    return [49.8175, 15.473];
  }, [markers]);

  const line = route?.points?.map((p) => [p.lat, p.lng] as [number, number]) ?? [];

  return (
    <div className="rounded-lg overflow-hidden border" style={{ height }}>
      <MapContainer center={center} zoom={8} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds markers={markers} route={route} />
        {line.length > 1 ? (
          <Polyline positions={line} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.85 }} />
        ) : null}
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
            icon={carIcon}
            eventHandlers={{
              click: () => onSelectVehicle?.(m.id),
            }}
            opacity={selectedVehicleId && selectedVehicleId !== m.id ? 0.55 : 1}
          >
            <Popup>
              <div className="text-sm space-y-1 min-w-[160px]">
                <p className="font-semibold">{m.licensePlate}</p>
                <p>{m.label}</p>
                <p>{movementStatusLabel(m.movementStatus)}</p>
                {m.driverName ? <p>Řidič: {m.driverName}</p> : null}
                {m.speedKmh != null ? <p>Rychlost: {Math.round(m.speedKmh)} km/h</p> : null}
                {m.lastUpdate ? (
                  <p className="text-xs text-muted-foreground">
                    GPS: {new Date(m.lastUpdate).toLocaleString("cs-CZ")}
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
