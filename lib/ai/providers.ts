import { isTestEnvironment } from "../constants";
import { titleModel } from "./models";
import { createChatModel } from "@/lib/llm/chat";

export const myProvider = isTestEnvironment
  ? (() => {
      const { chatModel, titleModel } = require("./models.mock");
      return {
        languageModel(modelId: string) {
          if (modelId === "title-model") {
            return titleModel;
          }
          return chatModel;
        },
      };
    })()
  : null;

export function getLanguageModel(modelId: string) {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel(modelId);
  }

  return createChatModel(modelId);
}

export function getTitleModel() {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model");
  }

  return createChatModel(titleModel.id);
}
