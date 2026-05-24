import { generateTextFromModel } from "@/lib/llm/generate";
import { codePrompt, updateDocumentPrompt } from "@/lib/ai/prompts";
import { createDocumentHandler } from "@/lib/artifacts/server";

function stripFences(code: string): string {
  return code
    .replace(/^```[\w]*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}

export const codeDocumentHandler = createDocumentHandler<"code">({
  kind: "code",
  onCreateDocument: async ({ title, dataStream, modelId }) => {
    const draftContent = stripFences(
      await generateTextFromModel({
        modelId,
        system: `${codePrompt}\n\nOutput ONLY the code. No explanations, no markdown fences, no wrapping.`,
        prompt: title,
      })
    );

    dataStream.write({
      type: "data-codeDelta",
      data: draftContent,
      transient: true,
    });

    return draftContent;
  },
  onUpdateDocument: async ({ document, description, dataStream, modelId }) => {
    const draftContent = stripFences(
      await generateTextFromModel({
        modelId,
        system: `${updateDocumentPrompt(document.content, "code")}\n\nOutput ONLY the complete updated code. No explanations, no markdown fences, no wrapping.`,
        prompt: description,
      })
    );

    dataStream.write({
      type: "data-codeDelta",
      data: draftContent,
      transient: true,
    });

    return draftContent;
  },
});
