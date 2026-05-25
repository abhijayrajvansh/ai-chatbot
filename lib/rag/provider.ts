export type RagProvider = "legacy-custom" | "pinecone-assistant";

const PINECONE_ASSISTANT_MIME_TYPES = new Set([
  "application/pdf",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
]);

export function getRagProvider(): RagProvider {
  return process.env.RAG_PROVIDER === "pinecone-assistant"
    ? "pinecone-assistant"
    : "legacy-custom";
}

export function isPineconeAssistantRagEnabled() {
  return getRagProvider() === "pinecone-assistant";
}

export function isSupportedPineconeAssistantFileType(type: string) {
  return PINECONE_ASSISTANT_MIME_TYPES.has(type);
}

export function getSupportedRagFileTypesMessage() {
  return isPineconeAssistantRagEnabled()
    ? "Supported types: pdf, docx, txt, md, json"
    : "Supported types: pdf, xls, xlsx, txt, md, csv, json";
}
