import { randomUUID } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminStorageBucket } from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { MeetingAudioMeta } from "@/lib/meeting-records-media-types";

export const MEETING_AUDIO_CHUNK_MAX_BYTES = 4 * 1024 * 1024;

export function meetingRecordDocPath(companyId: string, recordId: string): string {
  return `${COMPANIES_COLLECTION}/${companyId}/meetingRecords/${recordId}`;
}

export function meetingAudioChunkStoragePath(
  companyId: string,
  recordId: string,
  sessionId: string,
  chunkIndex: number
): string {
  return `companies/${companyId}/meetingRecords/${recordId}/audio/${sessionId}/chunk-${String(chunkIndex).padStart(5, "0")}.webm`;
}

export function meetingAudioFinalStoragePath(
  companyId: string,
  recordId: string,
  sessionId: string
): string {
  return `companies/${companyId}/meetingRecords/${recordId}/audio/${sessionId}/recording.webm`;
}

export function meetingRecordsCollection(db: Firestore, companyId: string) {
  return db.collection(COMPANIES_COLLECTION).doc(companyId).collection("meetingRecords");
}

export async function startMeetingAudioSession(
  db: Firestore,
  input: {
    companyId: string;
    recordId: string;
    userId: string;
    userName: string;
  }
): Promise<{ uploadSessionId: string }> {
  const uploadSessionId = randomUUID();
  const ref = meetingRecordsCollection(db, input.companyId).doc(input.recordId);
  const audio: MeetingAudioMeta = {
    status: "recording",
    uploadSessionId,
    chunkCount: 0,
    chunkPaths: [],
    recordedByUserId: input.userId,
    recordedByName: input.userName,
    mimeType: "audio/webm",
    durationSeconds: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.set({ audio, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { uploadSessionId };
}

export async function appendMeetingAudioChunk(
  db: Firestore,
  input: {
    companyId: string;
    recordId: string;
    uploadSessionId: string;
    chunkIndex: number;
    bytes: Buffer;
    mimeType: string;
  }
): Promise<{ storagePath: string }> {
  const bucket = getAdminStorageBucket();
  if (!bucket) throw new Error("Storage není nakonfigurováno.");

  if (input.bytes.length === 0) throw new Error("Prázdný segment.");
  if (input.bytes.length > MEETING_AUDIO_CHUNK_MAX_BYTES) {
    throw new Error("Segment je příliš velký.");
  }

  const storagePath = meetingAudioChunkStoragePath(
    input.companyId,
    input.recordId,
    input.uploadSessionId,
    input.chunkIndex
  );
  const file = bucket.file(storagePath);
  await file.save(input.bytes, {
    resumable: input.bytes.length > 2 * 1024 * 1024,
    metadata: { contentType: input.mimeType || "audio/webm" },
  });

  const ref = meetingRecordsCollection(db, input.companyId).doc(input.recordId);
  const snap = await ref.get();
  const audio = (snap.data()?.audio ?? {}) as MeetingAudioMeta;
  if (audio.uploadSessionId !== input.uploadSessionId) {
    throw new Error("Neplatná upload session.");
  }
  const chunkPaths = [...(audio.chunkPaths ?? [])];
  chunkPaths[input.chunkIndex] = storagePath;
  await ref.set(
    {
      audio: {
        ...audio,
        chunkPaths,
        chunkCount: Math.max(audio.chunkCount ?? 0, input.chunkIndex + 1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { storagePath };
}

export async function finalizeMeetingAudioRecording(
  db: Firestore,
  input: {
    companyId: string;
    recordId: string;
    uploadSessionId: string;
    durationSeconds: number;
  }
): Promise<{ storagePath: string }> {
  const bucket = getAdminStorageBucket();
  if (!bucket) throw new Error("Storage není nakonfigurováno.");

  const ref = meetingRecordsCollection(db, input.companyId).doc(input.recordId);
  const snap = await ref.get();
  const audio = (snap.data()?.audio ?? {}) as MeetingAudioMeta;
  if (audio.uploadSessionId !== input.uploadSessionId) {
    throw new Error("Neplatná upload session.");
  }
  const paths = (audio.chunkPaths ?? []).filter(Boolean);
  if (paths.length === 0) throw new Error("Chybí nahrané segmenty.");

  const buffers: Buffer[] = [];
  for (const p of paths) {
    const [buf] = await bucket.file(p).download();
    buffers.push(buf);
  }
  const merged = Buffer.concat(buffers);
  const finalPath = meetingAudioFinalStoragePath(
    input.companyId,
    input.recordId,
    input.uploadSessionId
  );
  await bucket.file(finalPath).save(merged, {
    resumable: merged.length > 2 * 1024 * 1024,
    metadata: { contentType: audio.mimeType || "audio/webm" },
  });

  await ref.set(
    {
      audio: {
        ...audio,
        status: "ready",
        storagePath: finalPath,
        durationSeconds: Math.max(0, Math.round(input.durationSeconds)),
        updatedAt: FieldValue.serverTimestamp(),
        errorMessage: null,
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { storagePath: finalPath };
}

export async function getMeetingAudioSignedUrl(storagePath: string): Promise<string> {
  const bucket = getAdminStorageBucket();
  if (!bucket) throw new Error("Storage není nakonfigurováno.");
  const [url] = await bucket.file(storagePath).getSignedUrl({
    action: "read",
    expires: Date.now() + 60 * 60 * 1000,
  });
  return url;
}
