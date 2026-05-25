import { geolocation, ipAddress } from "@vercel/functions";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "langchain";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import {
  allowedModelIds,
  DEFAULT_CHAT_MODEL,
} from "@/lib/ai/models";
import { systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  getRagDocumentsByUserId,
  saveChat,
  saveMessages,
  updateChatTitleById,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { isLocalUiOnlyMode } from "@/lib/local-mode";
import { checkIpRateLimit } from "@/lib/ratelimit";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages, generateUUID, getTextFromMessage } from "@/lib/utils";
import {
  formatRetrievedContext,
  getLatestUserText,
  getRelevantContextForUser,
} from "@/lib/rag/retrieval";
import {
  formatPineconeCitations,
  isPineconeAssistantConfigured,
  streamPineconeAssistantChat,
  toPineconeAssistantMessages,
} from "@/lib/rag/pinecone-assistant";
import { isPineconeAssistantRagEnabled } from "@/lib/rag/provider";
import { extractTextFromLangChainMessage } from "@/lib/llm/chat";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";
import type { DBMessage } from "@/lib/db/schema";

export const maxDuration = 60;

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}

export { getStreamContext };

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { id, message, messages, selectedChatModel } =
      requestBody;

    if (isLocalUiOnlyMode) {
      const latestUserText =
        message?.parts
          ?.filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(" ")
          .trim() ||
        messages
          ?.at(-1)
          ?.parts?.filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(" ")
          .trim() ||
        "your message";

      const stream = createUIMessageStream({
        originalMessages: messages as ChatMessage[] | undefined,
        execute: async ({ writer }) => {
          const textId = generateUUID();
          const chunks = [
            "UI-only mode is active, so this is a local mock response. ",
            `I received: "${latestUserText}". `,
            "Add real environment values later to enable auth, persistence, uploads, and live model calls.",
          ];

          writer.write({ type: "text-start", id: textId });
          for (const chunk of chunks) {
            writer.write({ type: "text-delta", id: textId, delta: chunk });
            await new Promise((resolve) => setTimeout(resolve, 60));
          }
          writer.write({ type: "text-end", id: textId });
          writer.write({
            type: "data-chat-title",
            data: "Local UI Preview",
          });
        },
        generateId: generateUUID,
      });

      return createUIMessageStreamResponse({ stream });
    }

    const [, session] = await Promise.all([
      process.env.NODE_ENV === "production"
        ? checkBotId().catch(() => null)
        : Promise.resolve(null),
      auth(),
    ]);

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const chatModel = allowedModelIds.has(selectedChatModel)
      ? selectedChatModel
      : DEFAULT_CHAT_MODEL;

    await checkIpRateLimit(ipAddress(request));

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 1,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
      return new ChatbotError("rate_limit:chat").toResponse();
    }

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      messagesFromDb = await getMessagesByChatId({ id });
    } else if (message?.role === "user") {
      await saveChat({
        id,
        userId: session.user.id,
        title: "New chat",
        visibility: "private",
      });
      titlePromise = generateTitleFromUserMessage({ message });
    }

    const uiMessages: ChatMessage[] = messages
      ? (messages as ChatMessage[])
      : [
          ...convertToUIMessages(messagesFromDb),
          message as ChatMessage,
        ].filter(Boolean) as ChatMessage[];

    const requestHints = geolocation(request);
    const userText =
      getLatestUserText(uiMessages) ||
      (message ? getTextFromMessage(message) : "");
    const pineconeReadyDocuments = isPineconeAssistantRagEnabled()
      ? (await getRagDocumentsByUserId({ userId: session.user.id })).filter(
          (document) =>
            document.ragProvider === "pinecone-assistant" &&
            document.status === "ready" &&
            Boolean(document.pineconeAssistantFileId)
        )
      : [];
    const usePineconeAssistant =
      pineconeReadyDocuments.length > 0 && isPineconeAssistantConfigured();

    if (allowedModelIds.size === 0 && !usePineconeAssistant) {
      return new ChatbotError(
        "bad_request:api",
        "No AI provider is configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, or LLM_BASE_URL with LLM_API_KEY."
      ).toResponse();
    }

    const retrievedContext = usePineconeAssistant
      ? ""
      : formatRetrievedContext(
          await getRelevantContextForUser({
            userId: session.user.id,
            query: userText,
          })
        );

    if (message?.role === "user") {
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: "user",
            parts: message.parts,
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });
    }

    const historyMessages = uiMessages.flatMap((currentMessage): BaseMessage[] => {
      const text = getTextFromMessage(currentMessage).trim();
      if (!text) {
        return [];
      }

      if (currentMessage.role === "assistant") {
        return [new AIMessage(text)];
      }

      return [new HumanMessage(text)];
    });

    const pineconeMessages = toPineconeAssistantMessages(uiMessages);
    const modelMessages: BaseMessage[] = [
      new SystemMessage(
        systemPrompt({
          requestHints,
          supportsTools: false,
          retrievedContext,
        })
      ),
      ...historyMessages,
    ];

    const model = usePineconeAssistant ? null : getLanguageModel(chatModel);

    const stream = createUIMessageStream({
      originalMessages: messages ? (uiMessages as ChatMessage[]) : undefined,
      execute: async ({ writer: dataStream }) => {
        const textId = generateUUID();
        dataStream.write({ type: "text-start", id: textId });

        try {
          if (usePineconeAssistant) {
            const citations: Parameters<typeof formatPineconeCitations>[0] = [];
            for await (const part of streamPineconeAssistantChat({
              messages: pineconeMessages,
              userId: session.user.id,
            })) {
              if (part.type === "text") {
                dataStream.write({
                  type: "text-delta",
                  id: textId,
                  delta: part.text,
                });
              } else {
                citations.push(part.citation);
              }
            }

            const formattedSources = formatPineconeCitations(citations);
            if (formattedSources) {
              dataStream.write({
                type: "text-delta",
                id: textId,
                delta: formattedSources,
              });
            }
          } else {
            if (!model) {
              throw new Error("No chat model is configured");
            }

            const responseStream = await model.stream(modelMessages);

            for await (const chunk of responseStream) {
              const delta = extractTextFromLangChainMessage(chunk);
              if (!delta) {
                continue;
              }

              dataStream.write({ type: "text-delta", id: textId, delta });
            }
          }
        } catch (_) {
          if (usePineconeAssistant) {
            throw _;
          }

          if (!model) {
            throw new Error("No chat model is configured");
          }

          // Fallback for providers/configurations that do not support streaming.
          const response = await model.invoke(modelMessages);
          const text = extractTextFromLangChainMessage(response);
          if (text) {
            dataStream.write({ type: "text-delta", id: textId, delta: text });
          }
        } finally {
          dataStream.write({ type: "text-end", id: textId });
        }

        if (titlePromise) {
          try {
            const title = await titlePromise;
            dataStream.write({ type: "data-chat-title", data: title });
            updateChatTitleById({ chatId: id, title });
          } catch (_) {
            /* non-fatal */
          }
        }
      },
      generateId: generateUUID,
      onFinish: async ({ messages: finishedMessages }) => {
        if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
              id: currentMessage.id,
              role: currentMessage.role,
              parts: currentMessage.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          });
        }
      },
      onError: (error) => {
        return error instanceof Error && error.message
          ? error.message
          : "Oops, an error occurred!";
      },
    });

    return createUIMessageStreamResponse({
      stream,
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ streamId, chatId: id });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch (_) {
          /* non-critical */
        }
      },
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
