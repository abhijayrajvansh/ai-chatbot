import Papa from "papaparse";
import * as XLSX from "xlsx";
import { saveDocument } from "@/lib/db/queries";
import { chunkText } from "@/lib/rag/chunk";
import { upsertDocumentChunksToVectorStore } from "@/lib/rag/vector";
import { generateUUID } from "@/lib/utils";

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
  const pdfParseModule = await import("pdf-parse");
  const parser = new pdfParseModule.PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    return parsed.text.trim();
  } finally {
    await parser.destroy();
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

  if (file.type === "application/pdf") {
    return extractTextFromPdf(buffer);
  }

  if (
    file.type === "application/vnd.ms-excel" ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return extractTextFromSpreadsheet(buffer);
  }

  const content = buffer.toString("utf-8");

  if (file.type === "text/csv") {
    return extractTextFromCsv(content);
  }

  return content.trim();
}

export async function ingestRagDocument({
  file,
  userId,
}: {
  file: File;
  userId: string;
}) {
  const fileName = sanitizeName(file.name);
  const text = (await extractTextFromRagFile(file)).trim();

  if (!text) {
    throw new Error("The uploaded file has no readable text");
  }

  const documentId = generateUUID();
  const chunks = chunkText(text);

  if (chunks.length === 0) {
    throw new Error("Could not chunk the uploaded text");
  }

  await saveDocument({
    id: documentId,
    title: fileName,
    kind: "text",
    content: text,
    userId,
  });

  await upsertDocumentChunksToVectorStore({
    userId,
    documentId,
    documentTitle: fileName,
    documentKind: "text",
    chunks,
  });

  return {
    documentId,
    fileName,
    chunkCount: chunks.length,
    mimeType: file.type,
    size: file.size,
  };
}
