import {
  getRagDocumentById,
  updateRagDocumentById,
} from "@/lib/db/queries";
import { ingestRagDocument } from "@/lib/rag/ingest";
import { type RagIngestJob } from "@/lib/rag/queue";
import { downloadRagFileFromStorage } from "@/lib/rag/storage";

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function getMaxRetries() {
  return parsePositiveInt(process.env.RAG_MAX_RETRIES, 3);
}

function getRetryBaseMs() {
  return parsePositiveInt(process.env.RAG_RETRY_BASE_MS, 500);
}

function shouldRetry(errorCode: string) {
  return errorCode === "extract_failed" || errorCode === "embed_failed";
}

function getErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("readable text") || message.includes("chunk")) {
    return "extract_failed";
  }
  if (message.includes("embed") || message.includes("vector")) {
    return "embed_failed";
  }
  return "index_failed";
}

export async function processRagIngestJob(job: RagIngestJob) {
  const maxRetries = getMaxRetries();
  const retryBaseMs = getRetryBaseMs();

  const ragDocument = await getRagDocumentById({ id: job.ragDocumentId });
  if (!ragDocument) {
    return { processed: false, reason: "missing_rag_document" as const };
  }

  const nextAttempt = (ragDocument.attempts ?? 0) + 1;
  await updateRagDocumentById({
    id: job.ragDocumentId,
    status: "processing",
    processingStartedAt: new Date(),
    attempts: nextAttempt,
    error: null,
    errorCode: null,
  });

  try {
    const buffer = await downloadRagFileFromStorage({
      storagePath: job.storagePath,
    });

    const ingested = await ingestRagDocument({
      fileName: ragDocument.fileName,
      mimeType: job.mimeType,
      fileSize: ragDocument.size,
      fileBuffer: buffer,
      userId: job.userId,
      documentId: ragDocument.documentId,
    });

    await updateRagDocumentById({
      id: job.ragDocumentId,
      documentId: ingested.documentId,
      status: "ready",
      chunkCount: ingested.chunkCount,
      error: null,
      errorCode: null,
      readyAt: new Date(),
    });

    return { processed: true, status: "ready" as const };
  } catch (error) {
    const errorCode = getErrorCode(error);
    const message = error instanceof Error ? error.message : "Failed to index";
    const retryable = shouldRetry(errorCode) && nextAttempt < maxRetries;

    await updateRagDocumentById({
      id: job.ragDocumentId,
      status: retryable ? "queued" : "failed",
      error: message,
      errorCode,
      failedAt: retryable ? null : new Date(),
      queuedAt: retryable ? new Date(Date.now() + retryBaseMs * nextAttempt) : undefined,
    });

    if (retryable) {
      return { processed: false, reason: "retryable_failure" as const };
    }

    return { processed: true, status: "failed" as const };
  }
}
