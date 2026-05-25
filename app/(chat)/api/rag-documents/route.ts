import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  deleteRagDocumentById,
  getRagDocumentById,
  getRagDocumentByChecksumForUser,
  getRagDocumentsByUserId,
  saveRagDocument,
  updateRagDocumentById,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { isLocalUiOnlyMode } from "@/lib/local-mode";
import {
  getRagFileChecksum,
  ingestRagDocument,
  isSupportedRagFileType,
} from "@/lib/rag/ingest";
import {
  deletePineconeAssistantFile,
  getPineconeAssistantFile,
  mapPineconeFileStatus,
  uploadFileToPineconeAssistant,
} from "@/lib/rag/pinecone-assistant";
import {
  getSupportedRagFileTypesMessage,
  isPineconeAssistantRagEnabled,
  isSupportedPineconeAssistantFileType,
} from "@/lib/rag/provider";
import { enqueueRagIngestJob } from "@/lib/rag/queue";
import { deleteRagFileFromStorage, uploadRagFileToStorage } from "@/lib/rag/storage";
import { deleteDocumentChunksFromVectorStore } from "@/lib/rag/vector";
import { processRagIngestJob } from "@/lib/rag/worker";
import { generateUUID } from "@/lib/utils";

const UploadSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size > 0, { message: "File is empty" })
    .refine((file) => file.size <= 50 * 1024 * 1024, {
      message: "File size should be less than 50MB",
    })
    .refine((file) => {
      if (isPineconeAssistantRagEnabled()) {
        return isSupportedPineconeAssistantFileType(file.type);
      }

      return isSupportedRagFileType(file.type);
    }, {
      message: getSupportedRagFileTypesMessage(),
    }),
});

const DeleteSchema = z.object({
  id: z.string().optional(),
  mode: z.enum(["single", "failed", "all"]).default("single"),
});

async function syncPineconeDocumentStatus(document: {
  id: string;
  ragProvider: string;
  pineconeAssistantFileId: string | null;
  status: string;
}) {
  if (
    document.ragProvider !== "pinecone-assistant" ||
    !document.pineconeAssistantFileId ||
    (document.status !== "queued" && document.status !== "processing")
  ) {
    return null;
  }

  try {
    const file = await getPineconeAssistantFile({
      fileId: document.pineconeAssistantFileId,
    });
    const mapped = mapPineconeFileStatus(file.status);
    await updateRagDocumentById({
      id: document.id,
      status: mapped.status,
      error: file.errorMessage ?? null,
      errorCode: mapped.errorCode,
      readyAt: mapped.status === "ready" ? new Date() : undefined,
      failedAt: mapped.status === "failed" ? new Date() : undefined,
      pineconeAssistantFileStatus: file.status,
      pineconeAssistantFileMetadata: file.metadata ?? null,
      pineconeSyncedAt: new Date(),
    });
    return await getRagDocumentById({ id: document.id });
  } catch (error) {
    await updateRagDocumentById({
      id: document.id,
      error:
        error instanceof Error
          ? error.message
          : "Failed to sync Pinecone Assistant status",
      errorCode: "pinecone_file_status_failed",
      pineconeSyncedAt: new Date(),
    }).catch(() => null);
    return null;
  }
}

export async function GET() {
  if (isLocalUiOnlyMode) {
    return Response.json({ documents: [] }, { status: 200 });
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:document").toResponse();
  }

  try {
    const documents = await getRagDocumentsByUserId({ userId: session.user.id });
    if (isPineconeAssistantRagEnabled()) {
      const synced = await Promise.all(
        documents.slice(0, 10).map((document) => syncPineconeDocumentStatus(document))
      );
      const syncedById = new Map(
        synced
          .filter((document) => Boolean(document))
          .map((document) => [document?.id, document])
      );

      return Response.json(
        {
          documents: documents.map(
            (document) => syncedById.get(document.id) ?? document
          ),
        },
        { status: 200 }
      );
    }

    return Response.json({ documents }, { status: 200 });
  } catch (error) {
    const cause = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { code: "bad_request:database", cause },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  if (isLocalUiOnlyMode) {
    return Response.json(
      {
        document: {
          id: generateUUID(),
          title: "Local RAG Document",
          fileName: "local.txt",
          chunkCount: 1,
          createdAt: new Date(),
        },
      },
      { status: 201 }
    );
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:document").toResponse();
  }

  if (request.body === null) {
    return new Response("Request body is empty", { status: 400 });
  }

  let ragDocumentId: string | null = null;

  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        {
          error:
            "Upload request was not received as multipart form data. Please try uploading the file again.",
          code: "invalid_upload_body",
        },
        { status: 400 }
      );
    }

    const file = formData.get("file") as Blob;

    const parsed = UploadSchema.safeParse({ file });

    if (!parsed.success) {
      const errorMessage = parsed.error.errors
        .map((error) => error.message)
        .join(", ");
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const uploadedFile = formData.get("file") as File;
    const checksum = await getRagFileChecksum(uploadedFile);

    const existingDocument = await getRagDocumentByChecksumForUser({
      userId: session.user.id,
      checksum,
    });

    if (existingDocument?.status === "ready") {
      return Response.json(
        { document: existingDocument, deduplicated: true },
        { status: 200 }
      );
    }

    ragDocumentId = generateUUID();
    const draftDocumentId = generateUUID();

    await saveRagDocument({
      id: ragDocumentId,
      documentId: draftDocumentId,
      title: uploadedFile.name,
      fileName: uploadedFile.name,
      mimeType: uploadedFile.type,
      size: uploadedFile.size,
      checksum,
      status: "queued",
      queuedAt: new Date(),
      attempts: 0,
      chunkCount: 0,
      ragProvider: isPineconeAssistantRagEnabled()
        ? "pinecone-assistant"
        : "legacy-custom",
      embeddingModel: isPineconeAssistantRagEnabled()
        ? "pinecone-assistant"
        : undefined,
      error: null,
      errorCode: null,
      userId: session.user.id,
    });

    const { storagePath } = await uploadRagFileToStorage({
      userId: session.user.id,
      ragDocumentId,
      file: uploadedFile,
    });

    await updateRagDocumentById({
      id: ragDocumentId,
      storagePath,
      status: "queued",
      queuedAt: new Date(),
      error: null,
      errorCode: null,
    });

    if (isPineconeAssistantRagEnabled()) {
      const uploaded = await uploadFileToPineconeAssistant({
        file: uploadedFile,
        userId: session.user.id,
        ragDocumentId,
        checksum,
      });
      const mappedStatus = mapPineconeFileStatus(uploaded.status);

      await updateRagDocumentById({
        id: ragDocumentId,
        status: mappedStatus.status,
        error: uploaded.errorMessage ?? null,
        errorCode: mappedStatus.errorCode,
        processingStartedAt: new Date(),
        readyAt: mappedStatus.status === "ready" ? new Date() : undefined,
        failedAt: mappedStatus.status === "failed" ? new Date() : undefined,
        pineconeAssistantName: process.env.PINECONE_ASSISTANT_NAME?.trim() ?? null,
        pineconeAssistantFileId: uploaded.id,
        pineconeAssistantFileStatus: uploaded.status,
        pineconeAssistantFileMetadata: uploaded.metadata ?? null,
        pineconeUploadedAt: new Date(),
        pineconeSyncedAt: new Date(),
      });

      const ragDocument = await getRagDocumentById({ id: ragDocumentId });

      return Response.json(
        {
          document:
            ragDocument ??
            ({
              id: ragDocumentId,
              documentId: draftDocumentId,
              title: uploadedFile.name,
              fileName: uploadedFile.name,
              mimeType: uploadedFile.type,
              size: uploadedFile.size,
              checksum,
              storagePath,
              status: mappedStatus.status,
              error: uploaded.errorMessage ?? null,
              errorCode: mappedStatus.errorCode,
              queuedAt: new Date(),
              processingStartedAt: new Date(),
              readyAt: null,
              failedAt: null,
              attempts: 0,
              embeddingModel: "pinecone-assistant",
              chunkCount: 0,
              ragProvider: "pinecone-assistant",
              pineconeAssistantName:
                process.env.PINECONE_ASSISTANT_NAME?.trim() ?? null,
              pineconeAssistantFileId: uploaded.id,
              pineconeAssistantFileStatus: uploaded.status,
              pineconeAssistantFileMetadata: uploaded.metadata ?? null,
              pineconeUploadedAt: new Date(),
              pineconeSyncedAt: new Date(),
              userId: session.user.id,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as const),
        },
        { status: 201 }
      );
    }

    const queued = await enqueueRagIngestJob({
      jobId: generateUUID(),
      ragDocumentId,
      userId: session.user.id,
      documentId: draftDocumentId,
      storagePath,
      mimeType: uploadedFile.type,
      checksum,
      enqueuedAt: new Date().toISOString(),
    });

    if (!queued) {
      const buffer = Buffer.from(await uploadedFile.arrayBuffer());
      const ingested = await ingestRagDocument({
        fileName: uploadedFile.name,
        mimeType: uploadedFile.type,
        fileSize: uploadedFile.size,
        fileBuffer: buffer,
        userId: session.user.id,
        documentId: draftDocumentId,
      });

      await updateRagDocumentById({
        id: ragDocumentId,
        documentId: ingested.documentId,
        status: "ready",
        chunkCount: ingested.chunkCount,
        readyAt: new Date(),
        error: null,
        errorCode: null,
      });
    } else {
      void processRagIngestJob({
        jobId: generateUUID(),
        ragDocumentId,
        userId: session.user.id,
        documentId: draftDocumentId,
        storagePath,
        mimeType: uploadedFile.type,
        checksum,
        enqueuedAt: new Date().toISOString(),
      }).catch(() => null);
    }

    const ragDocument = await getRagDocumentById({ id: ragDocumentId });

    return Response.json(
      {
        document:
          ragDocument ??
          ({
            id: ragDocumentId,
            documentId: draftDocumentId,
            title: uploadedFile.name,
            fileName: uploadedFile.name,
            mimeType: uploadedFile.type,
            size: uploadedFile.size,
            checksum,
            storagePath,
            status: "queued",
            error: null,
            errorCode: null,
            queuedAt: new Date(),
            processingStartedAt: null,
            readyAt: null,
            failedAt: null,
            attempts: 0,
            embeddingModel:
              process.env.OPENAI_EMBEDDING_MODEL?.trim() ??
              "text-embedding-3-small",
            chunkCount: 0,
            ragProvider: "legacy-custom",
            pineconeAssistantName: null,
            pineconeAssistantFileId: null,
            pineconeAssistantFileStatus: null,
            pineconeAssistantFileMetadata: null,
            pineconeUploadedAt: null,
            pineconeSyncedAt: null,
            userId: session.user.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as const),
      },
      { status: 201 }
    );
  } catch (error) {
    const cause =
      error instanceof Error ? error.message : "Failed to process request";
    const isValidationError = cause.includes("readable text") || cause.includes("chunk");
    const isPineconeError =
      cause.includes("Pinecone") || cause.includes("pinecone");
    const code = isValidationError
      ? "extract_failed"
      : isPineconeError
        ? "pinecone_file_upload_failed"
        : "index_failed";

    if (ragDocumentId) {
      await updateRagDocumentById({
        id: ragDocumentId,
        status: "failed",
        error: cause,
        errorCode: code,
        failedAt: new Date(),
      }).catch(() => null);
    }

    return NextResponse.json(
      { error: cause, code },
      { status: isValidationError ? 400 : 500 }
    );
  }
}

export async function DELETE(request: Request) {
  if (isLocalUiOnlyMode) {
    return Response.json({ deletedCount: 0 }, { status: 200 });
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:document").toResponse();
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid delete request" }, { status: 400 });
  }

  const { id, mode } = parsed.data;

  try {
    const allDocuments = await getRagDocumentsByUserId({ userId: session.user.id });
    const selected =
      mode === "all"
        ? allDocuments
        : mode === "failed"
          ? allDocuments.filter((document) => document.status === "failed")
          : allDocuments.filter((document) => document.id === id);

    if (mode === "single" && selected.length === 0) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    let deletedCount = 0;

    for (const document of selected) {
      if (
        document.ragProvider === "pinecone-assistant" &&
        document.pineconeAssistantFileId
      ) {
        await deletePineconeAssistantFile({
          fileId: document.pineconeAssistantFileId,
        }).catch(() => null);
      } else {
        try {
          await deleteDocumentChunksFromVectorStore({
            userId: document.userId,
            documentId: document.documentId,
          });
        } catch {
          // Continue best-effort cleanup for Firestore/Storage even if vector delete fails.
        }
      }

      if (document.storagePath) {
        await deleteRagFileFromStorage({
          storagePath: document.storagePath,
        }).catch(() => null);
      }

      const deleted = await deleteRagDocumentById({ id: document.id });
      if (deleted) {
        deletedCount += 1;
      }
    }

    return Response.json({ deletedCount }, { status: 200 });
  } catch (error) {
    const cause = error instanceof Error ? error.message : "Failed to delete";
    return NextResponse.json({ error: cause }, { status: 500 });
  }
}
