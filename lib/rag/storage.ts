import { randomUUID } from "node:crypto";
import { firebaseStorageBucket } from "@/lib/firebase/admin";

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function uploadRagFileToStorage({
  userId,
  ragDocumentId,
  file,
}: {
  userId: string;
  ragDocumentId: string;
  file: File;
}) {
  const safeName = sanitizeFileName(file.name);
  const storagePath = `rag/${userId}/${ragDocumentId}/${Date.now()}-${safeName}`;
  const token = randomUUID();
  const bucket = firebaseStorageBucket();
  const storageFile = bucket.file(storagePath);
  const buffer = Buffer.from(await file.arrayBuffer());

  await storageFile.save(buffer, {
    contentType: file.type,
    metadata: {
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  return {
    storagePath,
    downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`,
  };
}

export async function downloadRagFileFromStorage({
  storagePath,
}: {
  storagePath: string;
}) {
  const bucket = firebaseStorageBucket();
  const storageFile = bucket.file(storagePath);
  const [buffer] = await storageFile.download();
  return buffer;
}
