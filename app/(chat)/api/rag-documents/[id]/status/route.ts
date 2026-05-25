import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  getRagDocumentById,
  updateRagDocumentById,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { isLocalUiOnlyMode } from "@/lib/local-mode";
import {
  getPineconeAssistantFile,
  mapPineconeFileStatus,
} from "@/lib/rag/pinecone-assistant";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (isLocalUiOnlyMode) {
    return Response.json({ document: null }, { status: 200 });
  }

  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:document").toResponse();
  }

  const { id } = await params;
  const document = await getRagDocumentById({ id });

  if (!document || document.userId !== session.user.id) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (
    document.ragProvider !== "pinecone-assistant" ||
    !document.pineconeAssistantFileId
  ) {
    return Response.json({ document }, { status: 200 });
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
      readyAt:
        mapped.status === "ready" && !document.readyAt ? new Date() : undefined,
      failedAt: mapped.status === "failed" ? new Date() : undefined,
      pineconeAssistantFileStatus: file.status,
      pineconeAssistantFileMetadata: file.metadata ?? null,
      pineconeSyncedAt: new Date(),
    });

    const synced = await getRagDocumentById({ id: document.id });
    return Response.json({ document: synced ?? document }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to sync Pinecone Assistant status";
    await updateRagDocumentById({
      id: document.id,
      error: message,
      errorCode: "pinecone_file_status_failed",
      pineconeSyncedAt: new Date(),
    }).catch(() => null);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
