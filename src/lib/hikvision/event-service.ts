import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  hccAlarmCompleteBatch,
  hccAlarmPullMessages,
  hccAlarmSubscribe,
} from "@/lib/hikvision/hikconnect-openapi/client";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { HIKVISION_EVENTS_SUBCOLLECTION, type HikvisionCameraEventNormalized } from "@/lib/hikvision/types";
import {
  firestoreTimestampToIso,
  hikvisionCamerasCol,
  loadHikConnectApiCredentials,
} from "@/lib/hikvision/stores";

function eventsCol(db: Firestore, organizationId: string) {
  return db
    .collection(COMPANIES_COLLECTION)
    .doc(organizationId)
    .collection(HIKVISION_EVENTS_SUBCOLLECTION);
}

function mapAlarmType(raw: Record<string, unknown>): { type: string; title: string } {
  const sub = String(raw.alarmSubCategory ?? "");
  const main = String(raw.alarmMainCategory ?? "");
  const eventSource = (raw.eventSource ?? {}) as Record<string, unknown>;
  const eventType = String(eventSource.eventType ?? "");
  if (sub.includes("Camera") || main.includes("Video")) {
    if (eventType.includes("657") || eventType.includes("motion")) {
      return { type: "motion", title: "Detekován pohyb" };
    }
    return { type: "camera_alarm", title: "Událost kamery" };
  }
  if (sub.toLowerCase().includes("line")) {
    return { type: "line_cross", title: "Překročení čáry" };
  }
  if (sub.toLowerCase().includes("intrusion") || sub.toLowerCase().includes("region")) {
    return { type: "intrusion", title: "Vstup do oblasti" };
  }
  if (eventType.includes("person") || sub.toLowerCase().includes("person")) {
    return { type: "person", title: "Detekce osoby" };
  }
  if (eventType.includes("vehicle") || sub.toLowerCase().includes("vehicle")) {
    return { type: "vehicle", title: "Detekce vozidla" };
  }
  return { type: "other", title: "Alarm Hik-Connect" };
}

export class HikvisionEventService {
  constructor(
    private readonly db: Firestore,
    private readonly organizationId: string
  ) {}

  async ensureAlarmSubscription(): Promise<void> {
    const creds = await loadHikConnectApiCredentials(this.db, this.organizationId);
    if (!creds.ok) return;
    await hccAlarmSubscribe({
      organizationId: this.organizationId,
      db: this.db,
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      subscribe: true,
      eventTypes: [],
    });
  }

  async pollAndStoreAlarms(): Promise<{ ingested: number }> {
    const creds = await loadHikConnectApiCredentials(this.db, this.organizationId);
    if (!creds.ok) {
      return { ingested: 0 };
    }

    const camerasSnap = await hikvisionCamerasCol(this.db, this.organizationId).get();
    const byExternalId = new Map<string, string>();
    for (const doc of camerasSnap.docs) {
      const d = doc.data() as { externalCameraId?: string; trackStreamId?: string };
      const ext = String(d.externalCameraId ?? d.trackStreamId ?? "");
      if (ext) byExternalId.set(ext, doc.id);
    }

    let ingested = 0;
    for (let i = 0; i < 5; i++) {
      const batch = await hccAlarmPullMessages({
        organizationId: this.organizationId,
        db: this.db,
        apiKey: creds.apiKey,
        apiSecret: creds.apiSecret,
      });
      if (batch.messages.length === 0) break;

      for (const msg of batch.messages) {
        const raw = msg.raw;
        const eventSource = (raw.eventSource ?? {}) as Record<string, unknown>;
        const sourceId = String(eventSource.sourceID ?? "");
        const cameraId = byExternalId.get(sourceId) ?? null;
        const timeInfo = (raw.timeInfo ?? {}) as Record<string, unknown>;
        const occurred =
          String(timeInfo.startTimeLocal ?? timeInfo.startTime ?? new Date().toISOString());
        const mapped = mapAlarmType(raw);
        const docId = `hcc_${msg.guid}`;
        const ref = eventsCol(this.db, this.organizationId).doc(docId);
        const existing = await ref.get();
        if (existing.exists) continue;

        const deviceInfo = (eventSource.deviceInfo ?? {}) as Record<string, unknown>;
        await ref.set({
          organizationId: this.organizationId,
          deviceId: String(deviceInfo.devID ?? ""),
          cameraId,
          hikvisionEventId: msg.guid,
          eventType: mapped.type,
          title: mapped.title,
          eventTime: occurred,
          receivedAt: FieldValue.serverTimestamp(),
          payload: {
            alarmMainCategory: raw.alarmMainCategory,
            alarmSubCategory: raw.alarmSubCategory,
            sourceName: eventSource.sourceName,
            eventType: eventSource.eventType,
          },
          acknowledged: false,
          updatedAt: FieldValue.serverTimestamp(),
        });
        ingested += 1;
      }

      if (batch.batchId) {
        await hccAlarmCompleteBatch({
          organizationId: this.organizationId,
          db: this.db,
          apiKey: creds.apiKey,
          apiSecret: creds.apiSecret,
          batchId: batch.batchId,
        });
      }
      if ((batch.remainingNumber ?? 0) <= 0) break;
    }

    return { ingested };
  }

  async listEvents(limit = 100): Promise<HikvisionCameraEventNormalized[]> {
    const snap = await eventsCol(this.db, this.organizationId).limit(Math.min(limit, 300)).get();
    const docs = snap.docs.sort((a, b) => {
      const ta = String((a.data() as { eventTime?: string }).eventTime ?? "");
      const tb = String((b.data() as { eventTime?: string }).eventTime ?? "");
      return tb.localeCompare(ta);
    }).slice(0, limit);
    return docs.map((d) => {
      const row = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        organizationId: this.organizationId,
        deviceId: String(row.deviceId ?? ""),
        cameraId: row.cameraId != null ? String(row.cameraId) : null,
        hikvisionEventId: String(row.hikvisionEventId ?? d.id),
        type: String(row.eventType ?? "other"),
        title: String(row.title ?? "Událost"),
        occurredAt: String(row.eventTime ?? ""),
        receivedAt: firestoreTimestampToIso(row.receivedAt) ?? new Date().toISOString(),
        snapshotUrl: null,
        metadata: (row.payload as Record<string, unknown>) ?? {},
        acknowledged: row.acknowledged === true,
      };
    });
  }

  /** ISAPI alert stream — běží v Local Connector, ne na Vercel. */
  startAlertStream(): void {}
}
