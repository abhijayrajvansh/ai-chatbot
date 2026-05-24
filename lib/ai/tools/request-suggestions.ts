import { tool, type UIMessageStreamWriter } from "ai";
import { z } from "zod";
import type { Session } from "@/app/(auth)/auth";
import { getDocumentById, saveSuggestions } from "@/lib/db/queries";
import type { Suggestion } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import { generateTextFromModel } from "@/lib/llm/generate";

type RequestSuggestionsProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  modelId: string;
};

function parseSuggestionsOutput(text: string) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    return [];
  }

  try {
    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const originalSentence = String(
          (item as { originalSentence?: unknown }).originalSentence ?? ""
        ).trim();
        const suggestedSentence = String(
          (item as { suggestedSentence?: unknown }).suggestedSentence ?? ""
        ).trim();
        const description = String(
          (item as { description?: unknown }).description ?? ""
        ).trim();

        if (!originalSentence || !suggestedSentence || !description) {
          return null;
        }

        return { originalSentence, suggestedSentence, description };
      })
      .filter(Boolean) as {
      originalSentence: string;
      suggestedSentence: string;
      description: string;
    }[];
  } catch {
    return [];
  }
}

export const requestSuggestions = ({
  session,
  dataStream,
  modelId,
}: RequestSuggestionsProps) =>
  tool({
    description:
      "Request writing suggestions for an existing document artifact. Only use this when the user explicitly asks to improve or get suggestions for a document they have already created. Never use for general questions.",
    inputSchema: z.object({
      documentId: z
        .string()
        .describe(
          "The UUID of an existing document artifact that was previously created with createDocument"
        ),
    }),
    execute: async ({ documentId }) => {
      const document = await getDocumentById({ id: documentId });

      if (!document?.content) {
        return {
          error: "Document not found",
        };
      }

      if (document.userId !== session.user?.id) {
        return { error: "Forbidden" };
      }

      const prompt = [
        "Analyze the document below and return up to 5 suggestions.",
        "Return only valid JSON in the exact shape:",
        `[{"originalSentence":"...","suggestedSentence":"...","description":"..."}]`,
        "",
        document.content,
      ].join("\n");

      const text = await generateTextFromModel({
        modelId,
        system:
          "You are a writing assistant. Given a piece of writing, offer up to 5 suggestions to improve it. Each suggestion must contain full sentences, not just individual words. Describe what changed and why. Return only valid JSON.",
        prompt,
      });

      const suggestions = parseSuggestionsOutput(text);
      const persistedSuggestions: Omit<
        Suggestion,
        "userId" | "createdAt" | "documentCreatedAt"
      >[] = [];

      for (const item of suggestions) {
        const suggestion = {
          originalText: item.originalSentence,
          suggestedText: item.suggestedSentence,
          description: item.description,
          id: generateUUID(),
          documentId,
          isResolved: false,
        };

        dataStream.write({
          type: "data-suggestion",
          data: suggestion as Suggestion,
          transient: true,
        });

        persistedSuggestions.push(suggestion);
      }

      if (session.user?.id && persistedSuggestions.length > 0) {
        const userId = session.user.id;

        await saveSuggestions({
          suggestions: persistedSuggestions.map((suggestion) => ({
            ...suggestion,
            userId,
            createdAt: new Date(),
            documentCreatedAt: document.createdAt,
          })),
        });
      }

      return {
        id: documentId,
        title: document.title,
        kind: document.kind,
        message: "Suggestions have been added to the document",
      };
    },
  });
