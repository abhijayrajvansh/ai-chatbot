import "server-only";

import type { ChatMessage } from "@/lib/types";
import { getTextFromMessage } from "@/lib/utils";

export type PineconeAssistantFile = {
  id: string;
  name: string;
  status: string;
  size?: number;
  metadata?: Record<string, unknown> | null;
  errorMessage?: string | null;
};

export type PineconeAssistantChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type PineconeAssistantStreamPart =
  | { type: "text"; text: string }
  | { type: "citation"; citation: PineconeCitation };

type PineconeCitation = {
  references?: Array<{
    file?: {
      id?: string;
      name?: string;
      metadata?: Record<string, unknown> | null;
    };
    pages?: number[];
  }>;
};

type PineconeAssistantConfig = {
  apiKey: string;
  assistantName: string;
  assistantHost: string;
  apiVersion: string;
  model: string;
};

function getConfig(): PineconeAssistantConfig {
  const apiKey = process.env.PINECONE_API_KEY?.trim();
  const assistantName = process.env.PINECONE_ASSISTANT_NAME?.trim();
  const assistantHost = process.env.PINECONE_ASSISTANT_HOST?.trim();

  if (!apiKey || !assistantName || !assistantHost) {
    throw new Error(
      "Pinecone Assistant is not configured. Set PINECONE_API_KEY, PINECONE_ASSISTANT_NAME, and PINECONE_ASSISTANT_HOST."
    );
  }

  return {
    apiKey,
    assistantName,
    assistantHost: assistantHost.replace(/\/+$/, ""),
    apiVersion: process.env.PINECONE_ASSISTANT_API_VERSION?.trim() || "2025-04",
    model: process.env.PINECONE_ASSISTANT_MODEL?.trim() || "gpt-4o",
  };
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function getPineconeError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const data = payload as {
      message?: unknown;
      error?: unknown;
      detail?: unknown;
      error_message?: unknown;
    };
    for (const value of [
      data.message,
      data.error,
      data.detail,
      data.error_message,
    ]) {
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
  }

  return fallback;
}

function mapFile(payload: unknown): PineconeAssistantFile {
  const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const id = String(data.id ?? data.file_id ?? "");

  return {
    id,
    name: String(data.name ?? ""),
    status: String(data.status ?? ""),
    size: typeof data.size === "number" ? data.size : undefined,
    metadata:
      data.metadata && typeof data.metadata === "object"
        ? data.metadata as Record<string, unknown>
        : null,
    errorMessage:
      typeof data.error_message === "string" ? data.error_message : null,
  };
}

function getFileEndpoint(config: PineconeAssistantConfig, fileId?: string) {
  const assistant = encodeURIComponent(config.assistantName);
  const suffix = fileId ? `/${encodeURIComponent(fileId)}` : "";
  return `${config.assistantHost}/assistant/files/${assistant}${suffix}`;
}

export function isPineconeAssistantConfigured() {
  return Boolean(
    process.env.PINECONE_API_KEY?.trim() &&
      process.env.PINECONE_ASSISTANT_NAME?.trim() &&
      process.env.PINECONE_ASSISTANT_HOST?.trim()
  );
}

export async function uploadFileToPineconeAssistant({
  file,
  userId,
  ragDocumentId,
  checksum,
}: {
  file: File;
  userId: string;
  ragDocumentId: string;
  checksum: string;
}) {
  const config = getConfig();
  const metadata = {
    userId,
    ragDocumentId,
    checksum,
    source: "rag-chatbot-brackets",
  };
  const formData = new FormData();
  formData.append("file", file, file.name);

  const url = new URL(getFileEndpoint(config));
  url.searchParams.set("metadata", JSON.stringify(metadata));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Api-Key": config.apiKey,
      "X-Pinecone-Api-Version": config.apiVersion,
    },
    body: formData,
  });
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      getPineconeError(payload, "Failed to upload file to Pinecone Assistant")
    );
  }

  const uploaded = mapFile(payload);
  if (!uploaded.id) {
    throw new Error("Pinecone Assistant upload did not return a file id");
  }

  return uploaded;
}

export async function getPineconeAssistantFile({
  fileId,
}: {
  fileId: string;
}) {
  const config = getConfig();
  const url = new URL(getFileEndpoint(config, fileId));
  url.searchParams.set("include_url", "false");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Api-Key": config.apiKey,
      "X-Pinecone-Api-Version": config.apiVersion,
    },
  });
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      getPineconeError(payload, "Failed to get Pinecone Assistant file status")
    );
  }

  return mapFile(payload);
}

export async function deletePineconeAssistantFile({
  fileId,
}: {
  fileId: string;
}) {
  const config = getConfig();
  const response = await fetch(getFileEndpoint(config, fileId), {
    method: "DELETE",
    headers: {
      "Api-Key": config.apiKey,
      "X-Pinecone-Api-Version": config.apiVersion,
    },
  });

  if (!response.ok && response.status !== 404) {
    const payload = await parseJsonResponse(response);
    throw new Error(
      getPineconeError(payload, "Failed to delete Pinecone Assistant file")
    );
  }
}

function parseStreamLine(line: string): PineconeAssistantStreamPart | null {
  if (!line.startsWith("data:")) {
    return null;
  }

  const raw = line.slice("data:".length).trim();
  if (!raw || raw === "[DONE]") {
    return null;
  }

  const data = JSON.parse(raw) as {
    type?: string;
    delta?: { content?: unknown };
    citation?: PineconeCitation;
  };

  if (data.type === "content_chunk" && typeof data.delta?.content === "string") {
    return { type: "text", text: data.delta.content };
  }

  if (data.type === "citation" && data.citation) {
    return { type: "citation", citation: data.citation };
  }

  return null;
}

export async function* streamPineconeAssistantChat({
  messages,
  userId,
}: {
  messages: PineconeAssistantChatMessage[];
  userId: string;
}): AsyncIterable<PineconeAssistantStreamPart> {
  const config = getConfig();
  const assistant = encodeURIComponent(config.assistantName);
  const response = await fetch(
    `${config.assistantHost}/assistant/chat/${assistant}`,
    {
      method: "POST",
      headers: {
        "Api-Key": config.apiKey,
        "Content-Type": "application/json",
        "X-Pinecone-Api-Version": config.apiVersion,
      },
      body: JSON.stringify({
        messages,
        stream: true,
        model: config.model,
        filter: { userId },
      }),
    }
  );

  if (!response.ok || !response.body) {
    const payload = await parseJsonResponse(response);
    throw new Error(
      getPineconeError(payload, "Failed to chat with Pinecone Assistant")
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const part = parseStreamLine(line.trim());
      if (part) {
        yield part;
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const part = parseStreamLine(buffer.trim());
    if (part) {
      yield part;
    }
  }
}

export function toPineconeAssistantMessages(
  messages: ChatMessage[]
): PineconeAssistantChatMessage[] {
  return messages
    .map((message) => {
      const content = getTextFromMessage(message).trim();
      if (!content || (message.role !== "user" && message.role !== "assistant")) {
        return null;
      }

      return {
        role: message.role,
        content,
      };
    })
    .filter((message): message is PineconeAssistantChatMessage =>
      Boolean(message)
    );
}

export function formatPineconeCitations(citations: PineconeCitation[]) {
  const sources = new Map<string, string>();

  for (const citation of citations) {
    for (const reference of citation.references ?? []) {
      const fileId = reference.file?.id ?? reference.file?.name;
      const fileName = reference.file?.name ?? "Uploaded document";
      if (!fileId) {
        continue;
      }

      const pages =
        reference.pages && reference.pages.length > 0
          ? `, page${reference.pages.length > 1 ? "s" : ""} ${reference.pages.join(", ")}`
          : "";
      sources.set(fileId, `- ${fileName}${pages}`);
    }
  }

  if (sources.size === 0) {
    return "";
  }

  return `\n\nSources\n${Array.from(sources.values()).join("\n")}`;
}

export function mapPineconeFileStatus(status: string): {
  status: "queued" | "processing" | "ready" | "failed";
  errorCode: string | null;
} {
  const normalized = status.toLowerCase();
  if (normalized === "available" || normalized === "ready") {
    return { status: "ready", errorCode: null };
  }

  if (normalized.includes("failed") || normalized.includes("error")) {
    return { status: "failed", errorCode: "pinecone_file_processing_failed" };
  }

  return { status: "processing", errorCode: null };
}
