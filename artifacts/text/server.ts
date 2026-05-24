import { generateTextFromModel } from "@/lib/llm/generate";
import { updateDocumentPrompt } from "@/lib/ai/prompts";
import { createDocumentHandler } from "@/lib/artifacts/server";

export const textDocumentHandler = createDocumentHandler<"text">({
  kind: "text",
  onCreateDocument: async ({ title, dataStream, modelId }) => {
    const draftContent = await generateTextFromModel({
      modelId,
      system:
        "Write about the given topic. Markdown is supported. Use headings wherever appropriate.",
      prompt: title,
    });

    dataStream.write({
      type: "data-textDelta",
      data: draftContent,
      transient: true,
    });

    return draftContent;
  },
  onUpdateDocument: async ({ document, description, dataStream, modelId }) => {
    const draftContent = await generateTextFromModel({
      modelId,
      system: updateDocumentPrompt(document.content, "text"),
      prompt: description,
    });

    dataStream.write({
      type: "data-textDelta",
      data: draftContent,
      transient: true,
    });

    return draftContent;
  },
});
