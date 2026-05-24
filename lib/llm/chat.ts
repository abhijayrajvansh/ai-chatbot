import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "langchain";

export type LangChainChatModel = ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI;

function getOpenAIConfig(modelName: string) {
  const baseURL =
    process.env.LLM_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    undefined;
  const apiKey =
    process.env.LLM_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    undefined;

  return new ChatOpenAI({
    model: modelName,
    apiKey,
    configuration: baseURL ? { baseURL } : undefined,
    temperature: 0.2,
  });
}

function getAnthropicConfig(modelName: string) {
  return new ChatAnthropic({
    model: modelName,
    apiKey: process.env.ANTHROPIC_API_KEY?.trim(),
    temperature: 0.2,
  });
}

function getGoogleConfig(modelName: string) {
  return new ChatGoogleGenerativeAI({
    model: modelName,
    apiKey: process.env.GOOGLE_API_KEY?.trim(),
    temperature: 0.2,
  });
}

function resolveModelName(modelId: string) {
  const [, modelName] = modelId.split("/");
  return modelName || modelId;
}

function resolveProvider(modelId: string) {
  return modelId.split("/")[0] || "openai";
}

export function createChatModel(modelId: string): LangChainChatModel {
  const provider = resolveProvider(modelId);
  const modelName = resolveModelName(modelId);

  switch (provider) {
    case "anthropic":
      return getAnthropicConfig(modelName);
    case "google":
      return getGoogleConfig(modelName);
    case "openai":
    default:
      return getOpenAIConfig(
        modelId === "openai/custom"
          ? process.env.LLM_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini"
          : modelName
      );
  }
}

export function createTitleModel() {
  return createChatModel("openai/custom");
}

export function extractTextFromLangChainMessage(
  message: { content?: unknown }
) {
  const content = message.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object") {
          const maybeText = (part as { text?: unknown }).text;
          if (typeof maybeText === "string") {
            return maybeText;
          }
        }

        return "";
      })
      .join("");
  }

  return "";
}

export function toLangChainMessages(messages: {
  role: string;
  parts?: unknown;
}[]) : BaseMessage[] {
  const result: BaseMessage[] = [];

  for (const message of messages) {
    const text = Array.isArray(message.parts)
      ? message.parts
          .filter((part) => {
            return (
              part &&
              typeof part === "object" &&
              "type" in part &&
              (part as { type?: string }).type === "text"
            );
          })
          .map((part) => String((part as { text?: string }).text ?? ""))
          .join("")
      : "";

    if (!text.trim()) {
      continue;
    }

    switch (message.role) {
      case "assistant":
        result.push(new AIMessage(text));
        break;
      case "system":
        result.push(new SystemMessage(text));
        break;
      default:
        result.push(new HumanMessage(text));
        break;
    }
  }

  return result;
}
