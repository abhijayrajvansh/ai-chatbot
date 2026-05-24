import "server-only";

import {
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
  type Query,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { ChatbotError } from "../errors";
import { firestore } from "../firebase/admin";
import { firebaseCollections } from "../firebase/collections";
import { generateUUID } from "../utils";
import type {
  Chat,
  DBMessage,
  Document,
  DocumentChunk,
  RagDocument,
  Stream,
  Suggestion,
  Vote,
} from "./schema";
import { chunkText } from "@/lib/rag/chunk";

const {
  chats: CHATS,
  messages: MESSAGES,
  votes: VOTES,
  documents: DOCUMENTS,
  documentChunks: DOCUMENT_CHUNKS,
  ragDocuments: RAG_DOCUMENTS,
  suggestions: SUGGESTIONS,
  streams: STREAMS,
} = firebaseCollections;

function toDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }

  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (typeof value === "string" || typeof value === "number") {
    return new Date(value);
  }

  return new Date();
}

function isFirestoreMissingIndexError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as { message?: unknown; code?: unknown };
  const message =
    typeof maybeError.message === "string" ? maybeError.message : "";
  const code = typeof maybeError.code === "string" ? maybeError.code : "";

  return (
    code.includes("failed-precondition") ||
    message.includes("requires an index") ||
    message.includes("FAILED_PRECONDITION")
  );
}

function getErrorCause(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "Unknown database error";
}

function clean<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as T;
}

function cleanDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cleanDeep);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, cleanDeep(item)])
    );
  }

  return value;
}

function mapChat(snapshot: DocumentSnapshot<DocumentData>): Chat {
  const data = snapshot.data() ?? {};
  return {
    id: String(data.id ?? snapshot.id),
    createdAt: toDate(data.createdAt),
    title: String(data.title ?? ""),
    userId: String(data.userId ?? ""),
    visibility: (data.visibility as VisibilityType | undefined) ?? "private",
  };
}

function mapMessage(snapshot: DocumentSnapshot<DocumentData>): DBMessage {
  const data = snapshot.data() ?? {};
  return {
    id: String(data.id ?? snapshot.id),
    chatId: String(data.chatId ?? ""),
    role: String(data.role ?? ""),
    parts: data.parts ?? [],
    attachments: data.attachments ?? [],
    createdAt: toDate(data.createdAt),
  };
}

function mapVote(snapshot: DocumentSnapshot<DocumentData>): Vote {
  const data = snapshot.data() ?? {};
  return {
    chatId: String(data.chatId ?? ""),
    messageId: String(data.messageId ?? snapshot.id),
    isUpvoted: Boolean(data.isUpvoted),
  };
}

function mapDocument(snapshot: DocumentSnapshot<DocumentData>): Document {
  const data = snapshot.data() ?? {};
  return {
    id: String(data.id ?? ""),
    createdAt: toDate(data.createdAt),
    title: String(data.title ?? ""),
    content: (data.content as string | null | undefined) ?? null,
    kind: (data.kind as ArtifactKind | undefined) ?? "text",
    userId: String(data.userId ?? ""),
  };
}

function mapDocumentChunk(
  snapshot: DocumentSnapshot<DocumentData>
): DocumentChunk {
  const data = snapshot.data() ?? {};
  return {
    id: String(data.id ?? snapshot.id),
    documentId: String(data.documentId ?? ""),
    documentTitle: String(data.documentTitle ?? ""),
    documentKind: (data.documentKind as DocumentChunk["documentKind"]) ?? "text",
    chunkIndex: Number(data.chunkIndex ?? 0),
    content: String(data.content ?? ""),
    userId: String(data.userId ?? ""),
    createdAt: toDate(data.createdAt),
  };
}

function mapSuggestion(
  snapshot: DocumentSnapshot<DocumentData>
): Suggestion {
  const data = snapshot.data() ?? {};
  return {
    id: String(data.id ?? snapshot.id),
    documentId: String(data.documentId ?? ""),
    documentCreatedAt: toDate(data.documentCreatedAt),
    originalText: String(data.originalText ?? ""),
    suggestedText: String(data.suggestedText ?? ""),
    description: (data.description as string | null | undefined) ?? null,
    isResolved: Boolean(data.isResolved),
    userId: String(data.userId ?? ""),
    createdAt: toDate(data.createdAt),
  };
}

function mapStream(snapshot: DocumentSnapshot<DocumentData>): Stream {
  const data = snapshot.data() ?? {};
  return {
    id: String(data.id ?? snapshot.id),
    chatId: String(data.chatId ?? ""),
    createdAt: toDate(data.createdAt),
  };
}

function mapRagDocument(snapshot: DocumentSnapshot<DocumentData>): RagDocument {
  const data = snapshot.data() ?? {};
  return {
    id: String(data.id ?? snapshot.id),
    documentId: String(data.documentId ?? ""),
    title: String(data.title ?? ""),
    fileName: String(data.fileName ?? ""),
    mimeType: String(data.mimeType ?? ""),
    size: Number(data.size ?? 0),
    checksum: String(data.checksum ?? ""),
    storagePath:
      typeof data.storagePath === "string" ? data.storagePath : null,
    status:
      (data.status as RagDocument["status"] | undefined) ?? "processing",
    error: (data.error as string | null | undefined) ?? null,
    errorCode: (data.errorCode as string | null | undefined) ?? null,
    queuedAt: data.queuedAt ? toDate(data.queuedAt) : null,
    processingStartedAt: data.processingStartedAt
      ? toDate(data.processingStartedAt)
      : null,
    readyAt: data.readyAt ? toDate(data.readyAt) : null,
    failedAt: data.failedAt ? toDate(data.failedAt) : null,
    attempts: Number(data.attempts ?? 0),
    embeddingModel:
      String(data.embeddingModel ?? process.env.OPENAI_EMBEDDING_MODEL ?? ""),
    chunkCount: Number(data.chunkCount ?? 0),
    userId: String(data.userId ?? ""),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

async function deleteQuery(query: Query<DocumentData>) {
  const snapshot = await query.get();

  if (snapshot.empty) {
    return 0;
  }

  let deletedCount = 0;
  const db = firestore();

  for (let index = 0; index < snapshot.docs.length; index += 500) {
    const batch = db.batch();
    const docs = snapshot.docs.slice(index, index + 500);

    for (const doc of docs) {
      batch.delete(doc.ref);
    }

    await batch.commit();
    deletedCount += docs.length;
  }

  return deletedCount;
}

async function deleteSnapshots(docs: QueryDocumentSnapshot<DocumentData>[]) {
  if (docs.length === 0) {
    return 0;
  }

  let deletedCount = 0;
  const db = firestore();

  for (let index = 0; index < docs.length; index += 500) {
    const batch = db.batch();
    const chunk = docs.slice(index, index + 500);

    for (const doc of chunk) {
      batch.delete(doc.ref);
    }

    await batch.commit();
    deletedCount += chunk.length;
  }

  return deletedCount;
}

async function deleteDocumentChunkSnapshots(
  docs: QueryDocumentSnapshot<DocumentData>[]
) {
  return deleteSnapshots(docs);
}

function documentVersionKey(id: string, createdAt: Date) {
  return `${id}_${createdAt.getTime()}_${generateUUID()}`;
}

async function deleteDocumentChunksByDocumentId(documentId: string) {
  const db = firestore();
  const snapshot = await db
    .collection(DOCUMENT_CHUNKS)
    .where("documentId", "==", documentId)
    .get();

  await deleteDocumentChunkSnapshots(snapshot.docs);
}

async function saveDocumentChunks({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  const chunks = chunkText(content);
  if (chunks.length === 0) {
    return;
  }
  const batch = firestore().batch();

  for (const chunk of chunks) {
    const ref = firestore()
      .collection(DOCUMENT_CHUNKS)
      .doc(`${id}_${chunk.chunkIndex}`);
    batch.set(ref, {
      id: ref.id,
      documentId: id,
      documentTitle: title,
      documentKind: kind,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      userId,
      createdAt: new Date(),
    });
  }

  await batch.commit();
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  try {
    const item = {
      id,
      createdAt: new Date(),
      userId,
      title,
      visibility,
    };

    await firestore().collection(CHATS).doc(id).set(item);
    return item;
  } catch {
    throw new ChatbotError("bad_request:database", "Failed to save chat");
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    const db = firestore();
    await Promise.all([
      deleteQuery(db.collection(VOTES).where("chatId", "==", id)),
      deleteQuery(db.collection(MESSAGES).where("chatId", "==", id)),
      deleteQuery(db.collection(STREAMS).where("chatId", "==", id)),
    ]);

    const chatRef = db.collection(CHATS).doc(id);
    const snapshot = await chatRef.get();
    const deletedChat = snapshot.exists ? mapChat(snapshot) : undefined;
    await chatRef.delete();
    return deletedChat;
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete chat by id"
    );
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    const db = firestore();
    const snapshot = await db
      .collection(CHATS)
      .where("userId", "==", userId)
      .get();

    if (snapshot.empty) {
      return { deletedCount: 0 };
    }

    await Promise.all(
      snapshot.docs.map((doc) => deleteChatById({ id: doc.id }))
    );

    return { deletedCount: snapshot.size };
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete all chats by user id"
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const db = firestore();
    const extendedLimit = limit + 1;
    let selectedChat: Chat | null = null;

    if (startingAfter || endingBefore) {
      const cursorSnapshot = await db
        .collection(CHATS)
        .doc(startingAfter ?? endingBefore ?? "")
        .get();

      if (!cursorSnapshot.exists) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${startingAfter ?? endingBefore} not found`
        );
      }

      selectedChat = mapChat(cursorSnapshot);
    }

    let query: Query<DocumentData> = db
      .collection(CHATS)
      .where("userId", "==", id)
      .orderBy("createdAt", "desc")
      .limit(extendedLimit);

    if (startingAfter && selectedChat) {
      query = db
        .collection(CHATS)
        .where("userId", "==", id)
        .where("createdAt", ">", selectedChat.createdAt)
        .orderBy("createdAt", "desc")
        .limit(extendedLimit);
    } else if (endingBefore && selectedChat) {
      query = db
        .collection(CHATS)
        .where("userId", "==", id)
        .where("createdAt", "<", selectedChat.createdAt)
        .orderBy("createdAt", "desc")
        .limit(extendedLimit);
    }

    let filteredChats: Chat[];

    try {
      const snapshot = await query.get();
      filteredChats = snapshot.docs.map(mapChat);
    } catch (queryError) {
      if (!isFirestoreMissingIndexError(queryError)) {
        throw queryError;
      }

      // Fallback for environments where the composite index is not provisioned yet.
      const fallbackSnapshot = await db
        .collection(CHATS)
        .where("userId", "==", id)
        .get();

      filteredChats = fallbackSnapshot.docs
        .map(mapChat)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      if (startingAfter && selectedChat) {
        filteredChats = filteredChats.filter(
          (chat) => chat.createdAt > selectedChat.createdAt
        );
      } else if (endingBefore && selectedChat) {
        filteredChats = filteredChats.filter(
          (chat) => chat.createdAt < selectedChat.createdAt
        );
      }

      filteredChats = filteredChats.slice(0, extendedLimit);
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (error) {
    if (error instanceof ChatbotError) {
      throw error;
    }
    throw new ChatbotError(
      "bad_request:database",
      getErrorCause(error)
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const snapshot = await firestore().collection(CHATS).doc(id).get();
    return snapshot.exists ? mapChat(snapshot) : null;
  } catch {
    throw new ChatbotError("bad_request:database", "Failed to get chat by id");
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  try {
    const batch = firestore().batch();

    for (const item of messages) {
      const ref = firestore().collection(MESSAGES).doc(item.id);
      batch.set(
        ref,
        clean({
          ...item,
          parts: cleanDeep(item.parts),
          attachments: cleanDeep(item.attachments),
        })
      );
    }

    return await batch.commit();
  } catch (error) {
    throw new ChatbotError("bad_request:database", getErrorCause(error));
  }
}

export async function updateMessage({
  id,
  parts,
}: {
  id: string;
  parts: DBMessage["parts"];
}) {
  try {
    return await firestore().collection(MESSAGES).doc(id).update({ parts });
  } catch {
    throw new ChatbotError("bad_request:database", "Failed to update message");
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    let messages: DBMessage[];

    try {
      const snapshot = await firestore()
        .collection(MESSAGES)
        .where("chatId", "==", id)
        .orderBy("createdAt", "asc")
        .get();

      messages = snapshot.docs.map(mapMessage);
    } catch (queryError) {
      if (!isFirestoreMissingIndexError(queryError)) {
        throw queryError;
      }

      const fallbackSnapshot = await firestore()
        .collection(MESSAGES)
        .where("chatId", "==", id)
        .get();

      messages = fallbackSnapshot.docs
        .map(mapMessage)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    }

    return messages;
  } catch (error) {
    throw new ChatbotError(
      "bad_request:database",
      getErrorCause(error)
    );
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  try {
    return await firestore()
      .collection(VOTES)
      .doc(`${chatId}_${messageId}`)
      .set(
        {
          chatId,
          messageId,
          isUpvoted: type === "up",
        },
        { merge: true }
      );
  } catch {
    throw new ChatbotError("bad_request:database", "Failed to vote message");
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    const snapshot = await firestore()
      .collection(VOTES)
      .where("chatId", "==", id)
      .get();

    return snapshot.docs.map(mapVote);
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get votes by chat id"
    );
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  try {
    const createdAt = new Date();
    const item = {
      id,
      title,
      kind,
      content,
      userId,
      createdAt,
    };

    await firestore()
      .collection(DOCUMENTS)
      .doc(documentVersionKey(id, createdAt))
      .set(item);

    await deleteDocumentChunksByDocumentId(id);
    await saveDocumentChunks(item);

    return [item];
  } catch {
    throw new ChatbotError("bad_request:database", "Failed to save document");
  }
}

export async function updateDocumentContent({
  id,
  content,
}: {
  id: string;
  content: string;
}) {
  try {
    const snapshot = await firestore()
      .collection(DOCUMENTS)
      .where("id", "==", id)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    const latest = snapshot.docs[0];
    if (!latest) {
      throw new ChatbotError("not_found:database", "Document not found");
    }

    await latest.ref.update({ content });
    const updated = await latest.ref.get();

    const updatedDocument = mapDocument(updated);
    await deleteDocumentChunksByDocumentId(id);
    await saveDocumentChunks({
      id: updatedDocument.id,
      title: updatedDocument.title,
      kind: updatedDocument.kind,
      content,
      userId: updatedDocument.userId,
    });

    return [updatedDocument];
  } catch (error) {
    if (error instanceof ChatbotError) {
      throw error;
    }
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update document content"
    );
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    const snapshot = await firestore()
      .collection(DOCUMENTS)
      .where("id", "==", id)
      .orderBy("createdAt", "asc")
      .get();

    return snapshot.docs.map(mapDocument);
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get documents by id"
    );
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    const snapshot = await firestore()
      .collection(DOCUMENTS)
      .where("id", "==", id)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    const selectedDocument = snapshot.docs[0];
    return selectedDocument ? mapDocument(selectedDocument) : undefined;
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get document by id"
    );
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    const db = firestore();
    await deleteQuery(
      db
        .collection(SUGGESTIONS)
        .where("documentId", "==", id)
        .where("documentCreatedAt", ">", timestamp)
    );

    const snapshot = await db
      .collection(DOCUMENTS)
      .where("id", "==", id)
      .where("createdAt", ">", timestamp)
      .get();
    const deleted = snapshot.docs.map(mapDocument);

    await deleteQuery(
      db
        .collection(DOCUMENTS)
        .where("id", "==", id)
        .where("createdAt", ">", timestamp)
    );

    await deleteQuery(
      db
        .collection(DOCUMENT_CHUNKS)
        .where("documentId", "==", id)
        .where("createdAt", ">", timestamp)
    );

    return deleted;
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete documents by id after timestamp"
    );
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  try {
    const batch = firestore().batch();

    for (const item of suggestions) {
      const ref = firestore().collection(SUGGESTIONS).doc(item.id);
      batch.set(ref, clean({ ...item }));
    }

    return await batch.commit();
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to save suggestions"
    );
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    const snapshot = await firestore()
      .collection(SUGGESTIONS)
      .where("documentId", "==", documentId)
      .get();

    return snapshot.docs.map(mapSuggestion);
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get suggestions by document id"
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    const snapshot = await firestore().collection(MESSAGES).doc(id).get();
    return snapshot.exists ? [mapMessage(snapshot)] : [];
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get message by id"
    );
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const db = firestore();
    const messagesSnapshot = await db
      .collection(MESSAGES)
      .where("chatId", "==", chatId)
      .where("createdAt", ">=", timestamp)
      .get();
    const messageIds = messagesSnapshot.docs.map((doc) => doc.id);

    await Promise.all(
      messageIds.map((messageId) =>
        deleteQuery(
          db
            .collection(VOTES)
            .where("chatId", "==", chatId)
            .where("messageId", "==", messageId)
        )
      )
    );

    return await deleteSnapshots(messagesSnapshot.docs);
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete messages by chat id after timestamp"
    );
  }
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  try {
    return await firestore().collection(CHATS).doc(chatId).update({
      visibility,
    });
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update chat visibility by id"
    );
  }
}

export async function updateChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  try {
    return await firestore().collection(CHATS).doc(chatId).update({ title });
  } catch {
    return;
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  try {
    const cutoffTime = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000
    );
    const chatsSnapshot = await firestore()
      .collection(CHATS)
      .where("userId", "==", id)
      .get();

    const counts = await Promise.all(
      chatsSnapshot.docs.map(async (chatDoc) => {
        try {
          const snapshot = await firestore()
            .collection(MESSAGES)
            .where("chatId", "==", chatDoc.id)
            .where("role", "==", "user")
            .where("createdAt", ">=", cutoffTime)
            .get();

          return snapshot.size;
        } catch (queryError) {
          if (!isFirestoreMissingIndexError(queryError)) {
            throw queryError;
          }

          const fallbackSnapshot = await firestore()
            .collection(MESSAGES)
            .where("chatId", "==", chatDoc.id)
            .where("role", "==", "user")
            .get();

          return fallbackSnapshot.docs
            .map(mapMessage)
            .filter((message) => message.createdAt >= cutoffTime).length;
        }
      })
    );

    return counts.reduce((total, current) => total + current, 0);
  } catch (error) {
    throw new ChatbotError(
      "bad_request:database",
      getErrorCause(error)
    );
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await firestore()
      .collection(STREAMS)
      .doc(streamId)
      .set({ id: streamId, chatId, createdAt: new Date() });
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to create stream id"
    );
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const snapshot = await firestore()
      .collection(STREAMS)
      .where("chatId", "==", chatId)
      .orderBy("createdAt", "asc")
      .get();

    return snapshot.docs.map(mapStream).map(({ id }) => id);
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get stream ids by chat id"
    );
  }
}

export async function getDocumentChunksByUserId({
  userId,
}: {
  userId: string;
}) {
  try {
    const snapshot = await firestore()
      .collection(DOCUMENT_CHUNKS)
      .where("userId", "==", userId)
      .get();

    return snapshot.docs.map(mapDocumentChunk);
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get document chunks by user id"
    );
  }
}

export async function getRagDocumentsByUserId({ userId }: { userId: string }) {
  try {
    const snapshot = await firestore()
      .collection(RAG_DOCUMENTS)
      .where("userId", "==", userId)
      .get();

    return snapshot.docs
      .map(mapRagDocument)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get rag documents by user id"
    );
  }
}

export async function saveRagDocument({
  id,
  documentId,
  title,
  fileName,
  mimeType,
  size,
  checksum,
  storagePath,
  status,
  error,
  errorCode,
  queuedAt,
  processingStartedAt,
  readyAt,
  failedAt,
  attempts,
  embeddingModel,
  chunkCount,
  userId,
}: {
  id?: string;
  documentId: string;
  title: string;
  fileName: string;
  mimeType: string;
  size: number;
  checksum: string;
  storagePath?: string | null;
  status: RagDocument["status"];
  error?: string | null;
  errorCode?: string | null;
  queuedAt?: Date | null;
  processingStartedAt?: Date | null;
  readyAt?: Date | null;
  failedAt?: Date | null;
  attempts?: number;
  embeddingModel?: string;
  chunkCount: number;
  userId: string;
}) {
  try {
    const ragDocumentId = id ?? generateUUID();
    const createdAt = new Date();
    const updatedAt = createdAt;

    const item = {
      id: ragDocumentId,
      documentId,
      title,
      fileName,
      mimeType,
      size,
      checksum,
      storagePath: storagePath ?? null,
      status,
      error: error ?? null,
      errorCode: errorCode ?? null,
      queuedAt: queuedAt ?? null,
      processingStartedAt: processingStartedAt ?? null,
      readyAt: readyAt ?? null,
      failedAt: failedAt ?? null,
      attempts: attempts ?? 0,
      embeddingModel:
        embeddingModel ??
        process.env.OPENAI_EMBEDDING_MODEL?.trim() ??
        "text-embedding-3-small",
      chunkCount,
      userId,
      createdAt,
      updatedAt,
    };

    await firestore().collection(RAG_DOCUMENTS).doc(ragDocumentId).set(item);

    return item;
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to save rag document"
    );
  }
}

export async function getRagDocumentByChecksumForUser({
  userId,
  checksum,
}: {
  userId: string;
  checksum: string;
}) {
  try {
    const snapshot = await firestore()
      .collection(RAG_DOCUMENTS)
      .where("userId", "==", userId)
      .get();

    const selected = snapshot.docs
      .map(mapRagDocument)
      .filter((doc) => doc.checksum === checksum)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    return selected;
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get rag document by checksum"
    );
  }
}

export async function updateRagDocumentById({
  id,
  documentId,
  storagePath,
  status,
  chunkCount,
  error,
  errorCode,
  queuedAt,
  processingStartedAt,
  readyAt,
  failedAt,
  attempts,
}: {
  id: string;
  documentId?: string;
  storagePath?: string | null;
  status?: RagDocument["status"];
  chunkCount?: number;
  error?: string | null;
  errorCode?: string | null;
  queuedAt?: Date | null;
  processingStartedAt?: Date | null;
  readyAt?: Date | null;
  failedAt?: Date | null;
  attempts?: number;
}) {
  try {
    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (documentId !== undefined) {
      patch.documentId = documentId;
    }
    if (storagePath !== undefined) {
      patch.storagePath = storagePath;
    }
    if (status !== undefined) {
      patch.status = status;
    }
    if (chunkCount !== undefined) {
      patch.chunkCount = chunkCount;
    }
    if (error !== undefined) {
      patch.error = error;
    }
    if (errorCode !== undefined) {
      patch.errorCode = errorCode;
    }
    if (queuedAt !== undefined) {
      patch.queuedAt = queuedAt;
    }
    if (processingStartedAt !== undefined) {
      patch.processingStartedAt = processingStartedAt;
    }
    if (readyAt !== undefined) {
      patch.readyAt = readyAt;
    }
    if (failedAt !== undefined) {
      patch.failedAt = failedAt;
    }
    if (attempts !== undefined) {
      patch.attempts = attempts;
    }

    await firestore().collection(RAG_DOCUMENTS).doc(id).set(patch, {
      merge: true,
    });
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update rag document by id"
    );
  }
}

export async function getRagDocumentById({ id }: { id: string }) {
  try {
    const snapshot = await firestore().collection(RAG_DOCUMENTS).doc(id).get();
    if (!snapshot.exists) {
      return null;
    }
    return mapRagDocument(snapshot);
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get rag document by id"
    );
  }
}
