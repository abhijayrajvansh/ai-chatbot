import { getDocumentChunksByUserId } from "@/lib/db/queries";
import { queryDocumentChunksFromVectorStore } from "@/lib/rag/vector";
import { getTextFromMessage } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";

export type RetrievedContextChunk = {
  documentId: string;
  documentTitle: string;
  documentKind: string;
  chunkIndex: number;
  content: string;
};

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function tokenize(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/g)
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
  );
}

export async function getRelevantContextForUser({
  userId,
  query,
  limit = parsePositiveInt(process.env.RAG_TOP_K, 6),
}: {
  userId: string;
  query: string;
  limit?: number;
}) {
  const vectorResults = await queryDocumentChunksFromVectorStore({
    userId,
    query,
    limit,
  });

  if (vectorResults.length > 0) {
    return vectorResults;
  }

  const chunks = await getDocumentChunksByUserId({ userId });

  if (chunks.length === 0 || !query.trim()) {
    return [];
  }

  const queryTokens = tokenize(query);

  return chunks
    .map((chunk) => {
      const chunkTokens = tokenize(chunk.content);
      let score = 0;
      for (const token of queryTokens) {
        if (chunkTokens.has(token)) {
          score += 1;
        }
      }

      return {
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        documentKind: chunk.documentKind,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        score,
      };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...chunk }) => chunk);
}

export function formatRetrievedContext(
  chunks: RetrievedContextChunk[],
  maxLength = 8_000
) {
  if (chunks.length === 0) {
    return "";
  }

  let total = 0;
  const sections: string[] = [];

  for (const chunk of chunks) {
    const block = `Document: ${chunk.documentTitle}\nKind: ${chunk.documentKind}\nChunk: ${chunk.chunkIndex + 1}\nContent:\n${chunk.content}`;
    total += block.length;
    if (total > maxLength) {
      break;
    }
    sections.push(block);
  }

  return sections.join("\n\n---\n\n");
}

export function getLatestUserText(messages: ChatMessage[] | undefined) {
  const lastUserMessage = [...(messages ?? [])]
    .reverse()
    .find((message) => message.role === "user");

  if (!lastUserMessage) {
    return "";
  }

  return getTextFromMessage(lastUserMessage);
}
