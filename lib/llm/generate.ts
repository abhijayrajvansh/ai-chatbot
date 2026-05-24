import { HumanMessage, SystemMessage } from "langchain";
import { extractTextFromLangChainMessage } from "./chat";
import { getLanguageModel } from "@/lib/ai/providers";

export async function generateTextFromModel({
  modelId,
  system,
  prompt,
}: {
  modelId: string;
  system: string;
  prompt: string;
}) {
  const model = getLanguageModel(modelId);
  const response = await model.invoke([
    new SystemMessage(system),
    new HumanMessage(prompt),
  ]);

  return extractTextFromLangChainMessage(response).trim();
}
