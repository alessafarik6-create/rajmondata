import type { Firestore } from "firebase-admin/firestore";
import {
  extractListItems,
  satelitniRequest,
  unwrapSatelitniResource,
} from "@/lib/integrations/satelitni-sledovani/client";
import { describePayloadShape } from "@/lib/integrations/satelitni-sledovani/api-payload";
import {
  countStoredSatelitniFleet,
  syncSatelitniFleetForOrganization,
} from "@/lib/integrations/satelitni-sledovani/sync-service";
import {
  mapSatelitniLatestPosition,
  mapSatelitniVehicle,
  pickSatelitniExternalVehicleId,
  type SatelitniPositionApi,
  type SatelitniVehicleApi,
} from "@/lib/integrations/satelitni-sledovani/mappers";
import { loadSatelitniOAuthTokens } from "@/lib/integrations/satelitni-sledovani/store";
import { loadFleetIntegration } from "@/lib/fleet/stores";
import { SatelitniApiError } from "@/lib/integrations/satelitni-sledovani/problem-json";

export type SatelitniFleetDiagnostics = {
  oauthConnected: boolean;
  tokenActive: boolean;
  vehiclesApiOk: boolean;
  apiVehicleCount: number;
  storedVehicleCount: number;
  storedWithGpsCount: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  lastSyncSummary: string | null;
  responseShape: string | null;
  sampleVehicles: { externalVehicleId: string; name: string; externalDeviceId: string | null }[];
  lookup43081: {
    inApiList: boolean;
    asVehicleId: boolean;
    asDeviceId: boolean;
    note: string;
  };
  message: string;
  apiError: string | null;
};

export async function runSatelitniFleetDiagnostics(
  db: Firestore,
  organizationId: string
): Promise<SatelitniFleetDiagnostics> {
  const tokens = await loadSatelitniOAuthTokens(db, organizationId);
  const integration = await loadFleetIntegration(db, organizationId);
  const stored = await countStoredSatelitniFleet(db, organizationId);

  const base: SatelitniFleetDiagnostics = {
    oauthConnected: Boolean(tokens),
    tokenActive: Boolean(tokens && tokens.expiresAt.getTime() > Date.now()),
    vehiclesApiOk: false,
    apiVehicleCount: 0,
    storedVehicleCount: stored.storedVehicleCount,
    storedWithGpsCount: stored.storedWithGpsCount,
    lastSyncAt: integration?.lastSyncAt?.toDate?.()?.toISOString?.() ?? null,
    lastSyncError: integration?.lastSyncError ?? null,
    lastSyncSummary: integration?.lastSyncSummary ?? null,
    responseShape: null,
    sampleVehicles: [],
    lookup43081: {
      inApiList: false,
      asVehicleId: false,
      asDeviceId: false,
      note: "Test API vozidel nebyl spuštěn.",
    },
    message: "",
    apiError: null,
  };

  if (!tokens) {
    base.message = "OAuth není připojeno.";
    return base;
  }

  try {
    const { data } = await satelitniRequest<unknown>(db, organizationId, "/vehicles", {
      query: { limit: 500 },
    });
    base.responseShape = describePayloadShape(data);
    const list = extractListItems<SatelitniVehicleApi>(data);
    base.apiVehicleCount = list.length;
    base.vehiclesApiOk = true;
    base.sampleVehicles = list.slice(0, 8).map((v) => {
      const m = mapSatelitniVehicle(v);
      return {
        externalVehicleId: m.externalVehicleId,
        name: m.name,
        externalDeviceId: m.externalDeviceId,
      };
    });

    const target = "43081";
    for (const v of list) {
      const ext = pickSatelitniExternalVehicleId(v);
      const dev = v.device_id ?? v.deviceId;
      if (ext === target) base.lookup43081.asVehicleId = true;
      if (dev != null && String(dev) === target) base.lookup43081.asDeviceId = true;
    }
    base.lookup43081.inApiList = base.lookup43081.asVehicleId || base.lookup43081.asDeviceId;
    if (base.apiVehicleCount === 0) {
      base.lookup43081.note =
        "API vrátilo prázdný seznam. OAuth funguje, ale účet nemusí mít oprávnění k vozidlům nebo odpověď má jiný formát.";
    } else if (base.lookup43081.inApiList) {
      base.lookup43081.note = `Vozidlo / zařízení ${target} je v odpovědi API.`;
    } else {
      base.lookup43081.note = `ID ${target} v odpovědi API nebylo nalezeno (zkontrolujte připojený účet).`;
    }

    base.message =
      base.apiVehicleCount === 0
        ? "Připojení je aktivní, ale API nevrací žádná vozidla."
        : `API vrátilo ${base.apiVehicleCount} vozidel. V RAJMONDATA je uloženo ${base.storedVehicleCount} vozidel (${base.storedWithGpsCount} s GPS).`;
  } catch (e) {
    base.vehiclesApiOk = false;
    base.apiError = e instanceof SatelitniApiError ? e.message : e instanceof Error ? e.message : "Chyba API";
    base.message = `Přístup k API vozidel selhal: ${base.apiError}`;
  }

  return base;
}

export async function testSatelitniLatestPositionForVehicle(
  db: Firestore,
  organizationId: string,
  externalVehicleId: string
): Promise<{ ok: boolean; hasCoordinates: boolean; message: string }> {
  try {
    const { data } = await satelitniRequest<SatelitniPositionApi>(
      db,
      organizationId,
      `/vehicles/${encodeURIComponent(externalVehicleId)}/positions/latest`
    );
    const pos = mapSatelitniLatestPosition(unwrapSatelitniResource(data));
    if (!pos) {
      return { ok: true, hasCoordinates: false, message: "Odpověď bez platných souřadnic." };
    }
    return {
      ok: true,
      hasCoordinates: true,
      message: `Poloha OK (${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}).`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Chyba";
    return { ok: false, hasCoordinates: false, message: msg };
  }
}
