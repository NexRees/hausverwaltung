import { afterEach, describe, expect, it } from "vitest";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { deleteFile, readFile, s3Store, saveFile, setFileStore } from "./storage";

// In-memory stand-in for S3: records every command and keeps objects by key.
function fakeS3() {
  const objects = new Map<string, Uint8Array>();
  const calls: { name: string; Bucket?: string; Key?: string }[] = [];
  const client = {
    async send(cmd: PutObjectCommand | GetObjectCommand | DeleteObjectCommand) {
      const input = cmd.input as { Bucket: string; Key: string; Body?: Buffer };
      calls.push({ name: cmd.constructor.name, Bucket: input.Bucket, Key: input.Key });
      if (cmd instanceof PutObjectCommand) objects.set(input.Key, new Uint8Array(input.Body!));
      if (cmd instanceof DeleteObjectCommand) objects.delete(input.Key);
      if (cmd instanceof GetObjectCommand) {
        const body = objects.get(input.Key);
        if (!body) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
        return { Body: { transformToByteArray: async () => body } };
      }
      return {};
    },
  };
  return { client, objects, calls };
}

afterEach(() => setFileStore(undefined));

describe("storage on S3", () => {
  it("saves, reads and deletes through the bucket under the prefix", async () => {
    const s3 = fakeS3();
    setFileStore(s3Store(s3.client as never, "nexrees-staging-docs", "documents/"));

    const key = await saveFile(Buffer.from("Mietvertrag"), "vertrag.pdf");
    expect(key).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect([...s3.objects.keys()]).toEqual([`documents/${key}`]);
    expect(s3.calls[0]).toMatchObject({ name: "PutObjectCommand", Bucket: "nexrees-staging-docs" });

    expect((await readFile(key)).toString()).toBe("Mietvertrag");

    await deleteFile(key);
    expect(s3.objects.size).toBe(0);
  });

  it("keeps path traversal out of object keys", async () => {
    const s3 = fakeS3();
    setFileStore(s3Store(s3.client as never, "b"));
    await expect(readFile("../../etc/passwd")).rejects.toThrow("NoSuchKey");
    expect(s3.calls[0].Key).toBe("documents/passwd");
  });
});
