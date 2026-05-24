export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
};

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
};

const openaiBaseUrl =
  process.env.OPENAI_BASE_URL?.trim() || process.env.LLM_BASE_URL?.trim();

const openaiConfigured =
  Boolean(process.env.OPENAI_API_KEY?.trim()) ||
  Boolean(openaiBaseUrl && process.env.LLM_API_KEY?.trim());

const anthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

const googleConfigured = Boolean(process.env.GOOGLE_API_KEY?.trim());

const customOpenAiCompatibleConfigured = Boolean(
  process.env.LLM_API_KEY?.trim() && process.env.LLM_BASE_URL?.trim()
);

export const chatModels: ChatModel[] = [
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o mini",
    provider: "openai",
    description: "Fast OpenAI model for everyday chat and drafting",
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: false,
  },
  {
    id: "openai/gpt-4.1-mini",
    name: "GPT-4.1 mini",
    provider: "openai",
    description: "Balanced OpenAI model for chat and instructions",
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
  },
];

function isProviderConfigured(provider: string) {
  switch (provider) {
    case "openai":
      return openaiConfigured || customOpenAiCompatibleConfigured;
    case "anthropic":
      return anthropicConfigured;
    case "google":
      return googleConfigured;
    default:
      return false;
  }
}

export function isModelConfigured(modelId: string) {
  const model = chatModels.find((item) => item.id === modelId);
  if (!model) {
    return false;
  }
  return isProviderConfigured(model.provider);
}

export function getConfiguredChatModels() {
  return chatModels.filter((model) => isModelConfigured(model.id));
}

export function getCapabilities(): Record<string, ModelCapabilities> {
  return Object.fromEntries(
    getConfiguredChatModels().map((model) => [
      model.id,
      {
        tools: model.supportsTools ?? false,
        vision: model.supportsVision ?? false,
        reasoning: model.supportsReasoning ?? false,
      },
    ])
  );
}

export type GatewayModelWithCapabilities = ChatModel & {
  capabilities: ModelCapabilities;
};

export async function getAllGatewayModels(): Promise<
  GatewayModelWithCapabilities[]
> {
  return getConfiguredChatModels().map((model) => ({
    ...model,
    capabilities: {
      tools: model.supportsTools ?? false,
      vision: model.supportsVision ?? false,
      reasoning: model.supportsReasoning ?? false,
    },
  }));
}

export const isDemo = process.env.IS_DEMO === "1";

export function getDefaultChatModelId() {
  return getConfiguredChatModels()[0]?.id ?? chatModels[0].id;
}

export const DEFAULT_CHAT_MODEL = getDefaultChatModelId();

export const titleModel =
  chatModels.find((model) => model.id === DEFAULT_CHAT_MODEL) ?? chatModels[0];

export const allowedModelIds = new Set(getConfiguredChatModels().map((m) => m.id));

export const modelsByProvider = chatModels.reduce(
  (acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  },
  {} as Record<string, ChatModel[]>
);
