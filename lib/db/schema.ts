import type { ArtifactKind } from "@/components/chat/artifact";
import type { VisibilityType } from "@/components/chat/visibility-selector";

export type User = {
  id: string;
  email: string;
  password?: string | null;
  name?: string | null;
  emailVerified?: boolean;
  image?: string | null;
  isAnonymous?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

export type Chat = {
  id: string;
  createdAt: Date;
  title: string;
  userId: string;
  visibility: VisibilityType;
};

export type DBMessage = {
  id: string;
  chatId: string;
  role: string;
  parts: unknown;
  attachments: unknown;
  createdAt: Date;
};

export type Vote = {
  chatId: string;
  messageId: string;
  isUpvoted: boolean;
};

export type Document = {
  id: string;
  createdAt: Date;
  title: string;
  content: string | null;
  kind: ArtifactKind;
  userId: string;
};

export type DocumentChunk = {
  id: string;
  documentId: string;
  documentTitle: string;
  documentKind: ArtifactKind;
  chunkIndex: number;
  content: string;
  userId: string;
  createdAt: Date;
};

export type Suggestion = {
  id: string;
  documentId: string;
  documentCreatedAt: Date;
  originalText: string;
  suggestedText: string;
  description: string | null;
  isResolved: boolean;
  userId: string;
  createdAt: Date;
};

export type Stream = {
  id: string;
  chatId: string;
  createdAt: Date;
};

export type RagDocument = {
  id: string;
  documentId: string;
  title: string;
  fileName: string;
  mimeType: string;
  size: number;
  checksum: string;
  status: "queued" | "processing" | "ready" | "failed";
  error: string | null;
  embeddingModel: string;
  chunkCount: number;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
};
