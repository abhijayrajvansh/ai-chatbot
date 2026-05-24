import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { getRagDocumentsByUserId, saveRagDocument } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { isLocalUiOnlyMode } from "@/lib/local-mode";
import { ingestRagDocument, isSupportedRagFileType } from "@/lib/rag/ingest";
import { generateUUID } from "@/lib/utils";

const UploadSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size > 0, { message: "File is empty" })
    .refine((file) => file.size <= 5 * 1024 * 1024, {
      message: "File size should be less than 5MB",
    })
    .refine((file) => isSupportedRagFileType(file.type), {
      message: "Supported types: pdf, xls, xlsx, txt, md, csv, json",
    }),
});

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

  try {
    const formData = await request.formData();
    const file = formData.get("file") as Blob;

    const parsed = UploadSchema.safeParse({ file });

    if (!parsed.success) {
      const errorMessage = parsed.error.errors
        .map((error) => error.message)
        .join(", ");
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const uploadedFile = formData.get("file") as File;
    const ingested = await ingestRagDocument({
      file: uploadedFile,
      userId: session.user.id,
    });

    const ragDocument = await saveRagDocument({
      documentId: ingested.documentId,
      title: ingested.fileName,
      fileName: ingested.fileName,
      mimeType: ingested.mimeType,
      size: ingested.size,
      chunkCount: ingested.chunkCount,
      userId: session.user.id,
    });

    return Response.json({ document: ragDocument }, { status: 201 });
  } catch (error) {
    const cause = error instanceof Error ? error.message : "Failed to process request";
    return NextResponse.json(
      { error: cause },
      { status: 500 }
    );
  }
}
