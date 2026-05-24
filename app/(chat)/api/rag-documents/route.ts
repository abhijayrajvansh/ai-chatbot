import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  getRagDocumentsByUserId,
  saveDocument,
  saveRagDocument,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { isLocalUiOnlyMode } from "@/lib/local-mode";
import { chunkText } from "@/lib/rag/chunk";
import { generateUUID } from "@/lib/utils";

const UploadSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size > 0, { message: "File is empty" })
    .refine((file) => file.size <= 5 * 1024 * 1024, {
      message: "File size should be less than 5MB",
    })
    .refine(
      (file) =>
        [
          "text/plain",
          "text/markdown",
          "text/csv",
          "application/json",
        ].includes(file.type),
      {
        message: "Supported types: txt, md, csv, json",
      }
    ),
});

export async function GET() {
  if (isLocalUiOnlyMode) {
    return Response.json({ documents: [] }, { status: 200 });
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:document").toResponse();
  }

  const documents = await getRagDocumentsByUserId({ userId: session.user.id });

  return Response.json({ documents }, { status: 200 });
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

    const text = await file.text();
    const normalizedText = text.trim();

    if (!normalizedText) {
      return NextResponse.json(
        { error: "The uploaded file has no readable text" },
        { status: 400 }
      );
    }

    const fileName = ((formData.get("file") as File).name || "Untitled")
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .trim();

    const documentId = generateUUID();

    await saveDocument({
      id: documentId,
      title: fileName,
      kind: "text",
      content: normalizedText,
      userId: session.user.id,
    });

    const chunkCount = chunkText(normalizedText).length;

    const ragDocument = await saveRagDocument({
      documentId,
      title: fileName,
      fileName,
      mimeType: file.type,
      size: file.size,
      chunkCount,
      userId: session.user.id,
    });

    return Response.json({ document: ragDocument }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
