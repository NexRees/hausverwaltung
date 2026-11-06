import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

// Datei-Speicher: lokale Platte (Standard) oder S3, wenn STORAGE_S3_BUCKET gesetzt ist.
// nexrees: S3 für mehrere Container ohne gemeinsames Volume (AWS ECS). Schlüssel und
// Aufrufer bleiben gleich; Zugangsdaten kommen aus der Standard-Kette des AWS SDK
// (Task-Rolle, Umgebung), Verschlüsselung über die Bucket-Voreinstellung (SSE-KMS).
//   STORAGE_S3_BUCKET   Bucket-Name
//   STORAGE_S3_PREFIX   optionaler Pfad-Präfix (Standard "documents/")
//   STORAGE_S3_REGION   optional, sonst AWS_REGION

// turbopackIgnore an jedem fs-Aufruf: sonst verfolgt der Build den Ordner und packt alle
// Uploads ein; zeigt storage per Symlink nach außen (Proxmox), bricht der Build ab (#63).
const BASE = path.join(/* turbopackIgnore: true */ process.cwd(), "storage", "documents");
// Path-Traversal verhindern: nur Basename zulassen.
const safeKey = (key: string) => path.basename(key);
const file = (key: string) => path.join(/* turbopackIgnore: true */ BASE, safeKey(key));

export interface FileStore {
  put(key: string, buffer: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export const localStore: FileStore = {
  async put(key, buffer) {
    await fs.mkdir(/* turbopackIgnore: true */ BASE, { recursive: true });
    await fs.writeFile(/* turbopackIgnore: true */ file(key), buffer);
  },
  async get(key) {
    return fs.readFile(/* turbopackIgnore: true */ file(key));
  },
  async remove(key) {
    await fs.rm(/* turbopackIgnore: true */ file(key), { force: true });
  },
};

type S3Like = Pick<S3Client, "send">;

export function s3Store(client: S3Like, bucket: string, prefix = "documents/"): FileStore {
  const Key = (key: string) => `${prefix}${safeKey(key)}`;
  return {
    async put(key, buffer) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: Key(key), Body: buffer }));
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: Key(key) }));
      if (!res.Body) throw new Error(`Datei ${safeKey(key)} nicht gefunden`);
      return Buffer.from(await res.Body.transformToByteArray());
    },
    async remove(key) {
      // S3 meldet beim Löschen eines fehlenden Objekts keinen Fehler (wie fs.rm force).
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: Key(key) }));
    },
  };
}

let store: FileStore | undefined;
function current(): FileStore {
  if (store) return store;
  const bucket = process.env.STORAGE_S3_BUCKET?.trim();
  store = bucket
    ? s3Store(
        new S3Client({ region: process.env.STORAGE_S3_REGION || process.env.AWS_REGION }),
        bucket,
        process.env.STORAGE_S3_PREFIX ?? "documents/",
      )
    : localStore;
  return store;
}

/** Nur für Tests: Speicher ersetzen (undefined = wieder aus der Umgebung lesen). */
export function setFileStore(s: FileStore | undefined) {
  store = s;
}

export async function saveFile(buffer: Buffer, originalName: string): Promise<string> {
  const ext = path.extname(originalName).slice(0, 12);
  const key = `${crypto.randomUUID()}${ext}`;
  await current().put(key, buffer);
  return key;
}

export async function readFile(key: string): Promise<Buffer> {
  return current().get(key);
}

export async function deleteFile(key: string): Promise<void> {
  await current().remove(key);
}
