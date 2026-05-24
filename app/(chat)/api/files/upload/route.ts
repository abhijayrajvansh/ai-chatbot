import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import { firebaseStorageBucket } from "@/lib/firebase/admin";
import { isLocalUiOnlyMode } from "@/lib/local-mode";

const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= 5 * 1024 * 1024, {
      message: "File size should be less than 5MB",
    })
    .refine((file) => ["image/jpeg", "image/png"].includes(file.type), {
      message: "File type should be JPEG or PNG",
    }),
});

export async function POST(request: Request) {
  if (isLocalUiOnlyMode) {
    if (request.body === null) {
      return new Response("Request body is empty", { status: 400 });
    }

    try {
      const formData = await request.formData();
      const file = formData.get("file") as Blob;

      if (!file) {
        return NextResponse.json(
          { error: "No file uploaded" },
          { status: 400 }
        );
      }

      const validatedFile = FileSchema.safeParse({ file });

      if (!validatedFile.success) {
        const errorMessage = validatedFile.error.errors
          .map((error) => error.message)
          .join(", ");

        return NextResponse.json({ error: errorMessage }, { status: 400 });
      }

      const filename = (formData.get("file") as File).name;
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const buffer = Buffer.from(await file.arrayBuffer());

      return NextResponse.json({
        url: `data:${file.type};base64,${buffer.toString("base64")}`,
        pathname: safeName,
        contentType: file.type,
      });
    } catch (_error) {
      return NextResponse.json(
        { error: "Failed to process request" },
        { status: 500 }
      );
    }
  }

  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (request.body === null) {
    return new Response("Request body is empty", { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as Blob;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const validatedFile = FileSchema.safeParse({ file });

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.errors
        .map((error) => error.message)
        .join(", ");

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const filename = (formData.get("file") as File).name;
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileBuffer = await file.arrayBuffer();

    try {
      const bucket = firebaseStorageBucket();
      const token = randomUUID();
      const pathname = `uploads/${session.user.id}/${Date.now()}-${safeName}`;
      const storageFile = bucket.file(pathname);

      await storageFile.save(Buffer.from(fileBuffer), {
        contentType: file.type,
        metadata: {
          metadata: {
            firebaseStorageDownloadTokens: token,
          },
        },
      });

      return NextResponse.json({
        url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(pathname)}?alt=media&token=${token}`,
        pathname,
        contentType: file.type,
      });
    } catch (error) {
      console.error("Firebase Storage upload failed", error);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
