import { OpenAIEmbeddings } from "@langchain/openai";
import { Index } from "@upstash/vector";

export type VectorChunkMetadata = {
  userId: string;
  documentId: string;
  documentTitle: string;
  documentKind: string;
  chunkIndex: number;
};

function getEmbeddingModel() {
  const baseURL =
    process.env.LLM_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    undefined;

  const apiKey =
    process.env.LLM_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    undefined;

  if (!apiKey) {
    return null;
  }

  return new OpenAIEmbeddings({
    apiKey,
    model: process.env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
    configuration: baseURL ? { baseURL } : undefined,
  });
}

function getVectorIndex() {
  const url = process.env.UPSTASH_VECTOR_REST_URL?.trim();
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN?.trim();

  if (!url || !token) {
    return null;
  }

  return new Index<VectorChunkMetadata>({ url, token });
}

export function isVectorSearchEnabled() {
  return Boolean(getVectorIndex() && getEmbeddingModel());
}

export async function upsertDocumentChunksToVectorStore({
  userId,
  documentId,
  documentTitle,
  documentKind,
  chunks,
}: {
  userId: string;
  documentId: string;
  documentTitle: string;
  documentKind: string;
  chunks: Array<{ chunkIndex: number; content: string }>;
}) {
  const index = getVectorIndex();
  const embeddings = getEmbeddingModel();

  if (!index || !embeddings || chunks.length === 0) {
    return;
  }

  const vectors = await embeddings.embedDocuments(chunks.map((chunk) => chunk.content));

  await index.upsert(
    chunks.map((chunk, i) => ({
      id: `${userId}:${documentId}:${chunk.chunkIndex}`,
      vector: vectors[i],
      metadata: {
        userId,
        documentId,
        documentTitle,
        documentKind,
        chunkIndex: chunk.chunkIndex,
      },
      data: chunk.content,
    }))
  );
}

export async function queryDocumentChunksFromVectorStore({
  userId,
  query,
  limit,
}: {
  userId: string;
  query: string;
  limit: number;
}) {
  const index = getVectorIndex();
  const embeddings = getEmbeddingModel();

  if (!index || !embeddings || !query.trim()) {
    return [];
  }

  const vector = await embeddings.embedQuery(query);
  const retrievalCandidateK = Number.parseInt(
    process.env.RAG_RETRIEVAL_CANDIDATE_K ?? "",
    10
  );
  const defaultTopK = Math.max(limit * 8, 24);
  const topK =
    Number.isFinite(retrievalCandidateK) && retrievalCandidateK > 0
      ? Math.max(defaultTopK, retrievalCandidateK)
      : defaultTopK;

  const results = await index.query({
    vector,
    topK,
    includeData: true,
    includeMetadata: true,
  });

  return results
    .filter((result) => result.metadata?.userId === userId)
    .slice(0, limit)
    .map((result) => ({
      documentId: result.metadata?.documentId ?? "",
      documentTitle: result.metadata?.documentTitle ?? "",
      documentKind: result.metadata?.documentKind ?? "text",
      chunkIndex: result.metadata?.chunkIndex ?? 0,
      content: typeof result.data === "string" ? result.data : "",
    }))
    .filter((chunk) => Boolean(chunk.documentId) && Boolean(chunk.content));
}
