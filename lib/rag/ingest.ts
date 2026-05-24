import { createHash } from "node:crypto";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { saveDocument } from "@/lib/db/queries";
import { chunkText } from "@/lib/rag/chunk";
import { upsertDocumentChunksToVectorStore } from "@/lib/rag/vector";

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

export function isSupportedRagFileType(type: string) {
  return SUPPORTED_MIME_TYPES.has(type);
}

function sanitizeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._ -]/g, "_").trim() || "Untitled";
}

async function extractTextFromPdf(buffer: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "";
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
  });

  const pdf = await loadingTask.promise;
  try {
    const pages: string[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) =>
          "str" in item && typeof item.str === "string" ? item.str : ""
        )
        .join(" ")
        .trim();
      if (text) {
        pages.push(text);
      }
    }

    return pages.join("\n\n").trim();
  } finally {
    await pdf.destroy();
  }
}

function extractTextFromSpreadsheet(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetTexts = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return `# ${sheetName}\n${csv}`;
  });

  return sheetTexts.join("\n\n").trim();
}

function extractTextFromCsv(content: string) {
  const parsed = Papa.parse<string[]>(content, {
    skipEmptyLines: true,
  });

  return parsed.data.map((row) => row.join(" | ")).join("\n").trim();
}

export async function extractTextFromRagFile(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return extractTextFromRagBuffer({ buffer, mimeType: file.type });
}

export async function extractTextFromRagBuffer({
  buffer,
  mimeType,
}: {
  buffer: Buffer;
  mimeType: string;
}) {
  if (mimeType === "application/pdf") {
    return extractTextFromPdf(buffer);
  }

  if (
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return extractTextFromSpreadsheet(buffer);
  }

  const content = buffer.toString("utf-8");

  if (mimeType === "text/csv") {
    return extractTextFromCsv(content);
  }

  return content.trim();
}

export async function getRagFileChecksum(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return createHash("sha256").update(buffer).digest("hex");
}

export async function ingestRagDocument({
  fileName,
  mimeType,
  fileSize,
  fileBuffer,
  userId,
  documentId,
}: {
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileBuffer: Buffer;
  userId: string;
  documentId: string;
}) {
  const sanitizedName = sanitizeName(fileName);
  const text = (await extractTextFromRagBuffer({ buffer: fileBuffer, mimeType })).trim();

  if (!text) {
    throw new Error("The uploaded file has no readable text");
  }

  const chunks = chunkText(text);

  if (chunks.length === 0) {
    throw new Error("Could not chunk the uploaded text");
  }

  await saveDocument({
    id: documentId,
    title: sanitizedName,
    kind: "text",
    content: text,
    userId,
  });

  await upsertDocumentChunksToVectorStore({
    userId,
    documentId,
    documentTitle: sanitizedName,
    documentKind: "text",
    chunks,
  });

  return {
    documentId,
    fileName: sanitizedName,
    chunkCount: chunks.length,
    mimeType,
    size: fileSize,
  };
}
