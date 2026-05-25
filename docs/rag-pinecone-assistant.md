# RAG Migration Plan: Pinecone Assistant

This plan migrates the current custom RAG pipeline to Pinecone Assistant so PDF parsing, chunking, embedding, storage, retrieval, and citation context are handled by Pinecone instead of `pdfjs-dist`, local chunking, LangChain embeddings, and Upstash Vector.

## Goal

- Remove production dependency on `pdfjs-dist` for RAG document ingestion.
- Avoid serverless runtime failures such as `DOMMatrix is not defined`.
- Keep the existing app shell: Firebase Auth, Firestore metadata, chat history, document upload UI, and delete flows.
- Delegate document ingestion and document-grounded answering to Pinecone Assistant.
- Preserve per-user document isolation and ownership checks.

## Current Architecture

Current RAG flow:

```text
User uploads document
-> app/(chat)/api/rag-documents/route.ts
-> Firebase Storage
-> lib/rag/ingest.ts
-> pdfjs-dist / xlsx / papaparse
-> chunkText()
-> save full text in Firestore documents
-> save lexical chunks in Firestore document_chunks
-> OpenAIEmbeddings
-> Upstash Vector
-> lib/rag/retrieval.ts
-> app/(chat)/api/chat/route.ts injects retrieved context into systemPrompt()
-> configured LangChain chat model streams response
```

Main files involved today:

- `app/(chat)/api/rag-documents/route.ts`: validates uploads, stores metadata, uploads to Firebase Storage, starts ingestion.
- `lib/rag/ingest.ts`: extracts text, chunks content, saves documents, upserts vectors.
- `lib/rag/vector.ts`: embeds chunks and uses Upstash Vector.
- `lib/rag/retrieval.ts`: retrieves vector or Firestore lexical context.
- `lib/rag/worker.ts`: downloads stored files and runs async ingestion.
- `lib/db/schema.ts`: `RagDocument`, `Document`, and `DocumentChunk` types.
- `lib/db/queries.ts`: Firestore metadata, document, and chunk persistence.
- `app/(chat)/api/chat/route.ts`: retrieves RAG context before calling the selected chat model.
- `components/chat/rag-documents-panel.tsx`: upload/list/delete UI.

## Target Architecture

Target Pinecone Assistant flow:

```text
User uploads document
-> app/(chat)/api/rag-documents/route.ts
-> optional Firebase Storage retention
-> lib/rag/pinecone-assistant.ts uploads file to Pinecone Assistant
-> Firestore stores Pinecone assistant/file ids and processing status
-> status route polls/syncs Pinecone file status
-> chat route calls Pinecone Assistant for document-grounded answer
-> response is streamed or adapted into AI SDK UI message stream
```

Pinecone Assistant becomes the managed RAG layer:

- file parsing
- OCR/structured extraction where supported by Pinecone
- chunking
- embedding
- vector storage
- retrieval
- grounded answer generation
- citations/references returned by Pinecone

Docs to use during implementation:

- Pinecone Assistant overview: https://docs.pinecone.io/guides/assistant/overview
- File operations: https://docs.pinecone.io/guides/assistant/files-overview
- Upload files: https://docs.pinecone.io/guides/assistant/upload-files
- Chat with assistant: https://docs.pinecone.io/guides/assistant/chat-with-assistant
- API reference: https://docs.pinecone.io/reference/api/introduction

## Important Product Decision

Use **Pinecone Assistant**, not plain Pinecone Vector DB.

Plain Pinecone Vector DB would only replace Upstash Vector. It would still require:

- PDF parsing
- chunking
- embeddings
- retrieval prompt assembly
- citation assembly

Pinecone Assistant replaces the full document-Q&A subsystem, which is the reason it addresses the `pdfjs-dist` serverless failure class.

## Environment Variables

Add:

```env
PINECONE_API_KEY=
PINECONE_ASSISTANT_NAME=
PINECONE_ASSISTANT_HOST=
PINECONE_ASSISTANT_API_VERSION=2025-04
RAG_PROVIDER=pinecone-assistant
```

Optional migration/fallback flags:

```env
RAG_LEGACY_CUSTOM_ENABLED=0
RAG_KEEP_FIREBASE_SOURCE_FILES=1
RAG_ASSISTANT_STATUS_POLL_MS=3000
RAG_ASSISTANT_STATUS_TIMEOUT_MS=120000
```

Notes:

- `PINECONE_ASSISTANT_HOST` should be stored once the assistant exists.
- `PINECONE_ASSISTANT_API_VERSION` should be pinned and updated deliberately.
- Keep provider selection explicit with `RAG_PROVIDER` so the old custom path can remain behind a disabled fallback during rollout.

## Firestore Schema Changes

Extend `RagDocument`.

Current fields to keep:

- `id`
- `documentId`
- `title`
- `fileName`
- `mimeType`
- `size`
- `checksum`
- `storagePath`
- `status`
- `error`
- `errorCode`
- `queuedAt`
- `processingStartedAt`
- `readyAt`
- `failedAt`
- `attempts`
- `userId`
- `createdAt`
- `updatedAt`

Add:

```ts
ragProvider: "legacy-custom" | "pinecone-assistant";
pineconeAssistantName: string | null;
pineconeAssistantFileId: string | null;
pineconeAssistantFileStatus: string | null;
pineconeAssistantFileMetadata: Record<string, unknown> | null;
pineconeUploadedAt: Date | null;
pineconeSyncedAt: Date | null;
```

Repurpose or deprecate:

- `chunkCount`: keep for UI compatibility, but set to `0` or a Pinecone-reported value only if Pinecone exposes it reliably.
- `embeddingModel`: keep for legacy records, but do not use for Pinecone Assistant records.
- `documentId`: keep as internal app id for compatibility, but Pinecone file id becomes the external ingestion id.

Do not delete legacy fields immediately. Existing documents and UI paths depend on them.

## Pinecone Client Module

Create `lib/rag/pinecone-assistant.ts`.

Responsibilities:

- Read and validate Pinecone Assistant env vars.
- Upload a file to the configured assistant.
- Fetch file status by Pinecone file id.
- Delete a file from the assistant.
- Send chat messages to the assistant.
- Normalize assistant responses into app-friendly types.

Suggested API:

```ts
export type PineconeAssistantFile = {
  id: string;
  name: string;
  status: string;
  metadata?: Record<string, unknown>;
};

export async function uploadFileToPineconeAssistant(input: {
  file: File;
  userId: string;
  ragDocumentId: string;
  checksum: string;
}): Promise<PineconeAssistantFile>;

export async function getPineconeAssistantFile(input: {
  fileId: string;
}): Promise<PineconeAssistantFile>;

export async function deletePineconeAssistantFile(input: {
  fileId: string;
}): Promise<void>;

export async function streamPineconeAssistantChat(input: {
  userId: string;
  chatId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): AsyncIterable<{ textDelta?: string; citation?: unknown }>;
```

Metadata to send with uploaded files if supported:

```ts
{
  userId,
  ragDocumentId,
  checksum,
  source: "rag-chatbot-brackets"
}
```

If Pinecone Assistant file-level metadata filtering is unavailable or insufficient for chat, use one assistant per user or per tenant. See "Isolation Strategy".

## Upload Flow Changes

Update `app/(chat)/api/rag-documents/route.ts`.

Current behavior:

1. Validate file.
2. Save `rag_documents` as `queued`.
3. Upload to Firebase Storage.
4. Queue custom ingestion or run inline.
5. Use `pdfjs-dist` / local extractors.
6. Save chunks and vectors.

New behavior:

1. Validate file against Pinecone Assistant-supported types and plan limits.
2. Compute checksum for deduplication.
3. Reuse existing ready Pinecone-backed record when checksum matches for the same user.
4. Save `rag_documents` with:
   - `ragProvider: "pinecone-assistant"`
   - `status: "processing"` or `queued`
   - `chunkCount: 0`
   - `embeddingModel: "pinecone-assistant"`
5. Optionally upload source file to Firebase Storage for audit/download/delete recovery.
6. Upload file to Pinecone Assistant.
7. Store `pineconeAssistantFileId`, file status, and sync timestamps.
8. Poll once briefly, or return `processing` and let the UI/status route refresh.
9. Mark `ready` when Pinecone reports the file is available.
10. Mark `failed` if Pinecone reports failure or upload/status polling errors.

Do not call:

- `ingestRagDocument`
- `extractTextFromRagBuffer`
- `chunkText`
- `saveDocument`
- `upsertDocumentChunksToVectorStore`

## Status Sync

Add or update a status route.

Suggested route:

```text
GET /api/rag-documents/:id/status
```

Responsibilities:

- Authenticate user.
- Verify `rag_documents.userId`.
- If provider is Pinecone Assistant and file id exists, fetch status from Pinecone.
- Map Pinecone status to app status:
  - available/ready -> `ready`
  - processing/pending -> `processing`
  - failed/error -> `failed`
- Update Firestore fields:
  - `pineconeAssistantFileStatus`
  - `pineconeSyncedAt`
  - `status`
  - `readyAt` or `failedAt`
  - `error` / `errorCode`

The existing list route can also opportunistically sync stale processing records, but avoid doing many external calls on every list request.

## Chat Flow Changes

Update `app/(chat)/api/chat/route.ts`.

Current behavior:

1. Retrieve local vector/Firestore context through `getRelevantContextForUser`.
2. Inject retrieved context into `systemPrompt`.
3. Stream answer from selected LangChain model.

New Pinecone Assistant behavior:

1. Preserve existing auth, rate limit, chat ownership, chat creation, message persistence, and title generation.
2. Check whether the user has at least one ready Pinecone Assistant RAG document.
3. If no ready documents exist:
   - keep existing normal chat model path.
4. If ready documents exist:
   - send chat history and latest user message to Pinecone Assistant.
   - stream Pinecone Assistant response into `createUIMessageStream`.
   - save assistant response in the existing `messages` collection.
   - include citations/references in the assistant text or as typed data parts if the UI supports them.

This means Pinecone Assistant becomes the model for document-grounded answers. The selected app chat model may be ignored for RAG-backed conversations unless Pinecone supports passing model options compatible with our selector.

Open decision:

- Should every chat use Pinecone Assistant once the user has documents?
- Or should the UI expose a "Use documents" toggle?

Recommended first implementation:

- Use Pinecone Assistant only when the user has ready RAG documents.
- Keep standard chat path when no ready documents exist.
- Add a later toggle if users need non-RAG answers while documents are present.

## Retrieval Module Changes

`lib/rag/retrieval.ts` becomes legacy-only.

Options:

1. Keep it for fallback behind `RAG_LEGACY_CUSTOM_ENABLED=1`.
2. Remove imports from the chat route when `RAG_PROVIDER=pinecone-assistant`.
3. Delete it later after all legacy documents are migrated or expired.

Recommended:

- Keep it temporarily.
- Add a provider switch:

```ts
export function getRagProvider() {
  return process.env.RAG_PROVIDER === "pinecone-assistant"
    ? "pinecone-assistant"
    : "legacy-custom";
}
```

## Deletion Flow Changes

Update `DELETE /api/rag-documents`.

For Pinecone Assistant records:

1. Authenticate user.
2. Verify ownership.
3. Delete Pinecone Assistant file if `pineconeAssistantFileId` exists.
4. Delete Firebase Storage file if retained.
5. Delete `rag_documents` Firestore record.

Do not call legacy vector deletion for Pinecone records:

- `deleteDocumentChunksFromVectorStore`
- `deleteRagFileFromStorage` only if source file was retained
- legacy `documents` / `document_chunks` cleanup only for legacy records

Bulk delete should handle mixed providers safely.

## UI Changes

Update `components/chat/rag-documents-panel.tsx`.

Keep:

- upload dialog
- progress while browser uploads to app route
- document list
- delete single/failed/all
- failed error display

Change:

- Replace "chunks" as the primary readiness signal for Pinecone records.
- Show provider-aware metadata:
  - `processing`
  - `ready`
  - `failed`
  - file size
  - upload timestamp
- Hide or de-emphasize `0 chunks` for Pinecone Assistant records.
- Poll processing files through the status endpoint until ready/failed.
- Surface clearer errors:
  - unsupported file type
  - file too large for current Pinecone plan
  - Pinecone processing failed
  - Pinecone rate limit or auth/config error

Recommended status line for Pinecone records:

```text
ready • Pinecone Assistant • 135.1 KB • 25/05/2026, 12:15:06
```

## Supported File Types And Limits

Implementation must validate against Pinecone Assistant's current supported file types and current plan limits before upload. Do not rely only on the local legacy allowlist.

Current local allowlist:

- PDF
- XLS
- XLSX
- TXT
- MD
- CSV
- JSON

Before implementation, verify Pinecone Assistant support for:

- PDF
- TXT
- Markdown
- JSON
- DOCX if we want to add it
- CSV/XLS/XLSX support and limitations

If Pinecone Assistant does not support spreadsheet ingestion in the required way, keep a separate non-PDF ingestion path or temporarily disable spreadsheet uploads with a clear UI/API error.

## Isolation Strategy

This is the most important architecture decision.

We must prevent one user's documents from influencing another user's answers.

Possible strategies:

### Option A: One Assistant Per App, File Metadata Per User

Use one shared Pinecone Assistant and upload all files with `userId` metadata.

Pros:

- simpler operations
- fewer assistant resources
- easiest first deployment

Cons:

- only safe if Pinecone Assistant chat supports reliable file/metadata scoping for each query
- must verify API support before using in production

### Option B: One Assistant Per User

Create or assign a dedicated assistant per user.

Pros:

- strong isolation
- simple mental model
- no cross-user retrieval risk if assistant only contains that user's files

Cons:

- more Pinecone resources
- assistant lifecycle management
- more Firestore metadata

### Option C: One Assistant Per Tenant/Workspace

Use a dedicated assistant per organization/workspace if the app later adds teams.

Pros:

- good fit for shared team knowledge bases
- scalable isolation by tenant

Cons:

- not needed until the app has tenant/workspace concepts

Recommendation for this app today:

- Use **Option B: one assistant per user** unless Pinecone Assistant provides confirmed per-request file scoping or metadata filtering for chat.
- Store the user's assistant name/host in Firestore or derive a stable assistant name from a sanitized user id.

## Assistant Lifecycle

Add helper functions for:

- get or create assistant for user
- save assistant name/host for user
- upload file to user's assistant
- delete file from user's assistant
- optionally delete assistant when user/account is deleted

Potential Firestore model:

```ts
export type RagAssistantProfile = {
  id: string;
  userId: string;
  provider: "pinecone-assistant";
  assistantName: string;
  assistantHost: string | null;
  status: "active" | "failed";
  createdAt: Date;
  updatedAt: Date;
};
```

Collection:

```text
rag_assistant_profiles
```

If we use one app-wide assistant instead, this collection is not required.

## API Route Plan

Add:

- `lib/rag/provider.ts`: provider selection and feature flags.
- `lib/rag/pinecone-assistant.ts`: Pinecone Assistant client wrapper.
- `lib/rag/pinecone-status.ts`: maps Pinecone statuses to app statuses if useful.

Update:

- `app/(chat)/api/rag-documents/route.ts`
- `app/(chat)/api/chat/route.ts`
- `lib/db/schema.ts`
- `lib/db/queries.ts`
- `components/chat/rag-documents-panel.tsx`
- `docs/setup.md`
- `docs/rag-architecture.md`
- `.env.example`

Potentially remove later:

- `lib/rag/ingest.ts`
- `lib/rag/vector.ts`
- `lib/rag/retrieval.ts`
- `lib/rag/worker.ts`
- Upstash Vector env docs
- `pdfjs-dist` dependency
- `@types/pdf-parse` dependency if unused

Do not remove these in the first migration PR unless all legacy paths are intentionally dropped.

## Data Migration

Existing records may include legacy uploaded files and vector/chunk data.

Migration choices:

### Option A: Forward-Only

New uploads use Pinecone Assistant. Existing legacy documents remain available through the old retrieval path until manually deleted.

Pros:

- low risk
- no bulk reprocessing
- easiest deployment

Cons:

- two RAG paths during transition
- UI must handle mixed provider records

### Option B: Reingest Existing Files

For each existing `rag_documents` record with `storagePath`, upload the source file to Pinecone Assistant and update the record.

Pros:

- unified Pinecone Assistant path
- can eventually remove legacy code

Cons:

- requires a migration script/job
- source files must still exist in Firebase Storage
- Pinecone processing costs and limits apply

Recommended:

- Start with Option A.
- Add a separate admin-only migration script after Pinecone Assistant is validated in production.

## Error Handling

Add provider-specific error codes:

- `pinecone_config_missing`
- `pinecone_assistant_create_failed`
- `pinecone_file_upload_failed`
- `pinecone_file_processing_failed`
- `pinecone_file_delete_failed`
- `pinecone_chat_failed`
- `unsupported_rag_file_type`
- `rag_file_too_large`

User-facing messages should avoid raw SDK errors where possible.

Examples:

- "This file type is not supported by the document assistant."
- "The document assistant could not process this PDF."
- "Document search is temporarily unavailable. Please try again."

## Security Requirements

- Keep all Pinecone API keys server-only.
- Never expose Pinecone file ids in a way that allows cross-user access without auth checks.
- Always verify `rag_documents.userId === session.user.id`.
- If using shared assistant, verify Pinecone chat can be scoped to user files before production use.
- Log provider errors without logging document contents.
- Continue to validate file size and MIME type server-side.

## Testing Plan

Required checks after implementation:

- `pnpm exec tsc --noEmit`

Targeted manual/API checks:

- Upload valid PDF.
- Upload unsupported file type.
- Upload file above configured size limit.
- Poll processing document until ready.
- Ask a question answerable from uploaded PDF.
- Confirm answer includes citation/reference behavior.
- Delete one Pinecone-backed document.
- Bulk delete failed documents.
- Bulk delete all mixed legacy/Pinecone documents.
- Confirm another user cannot see or query the first user's files.
- Confirm standard chat still works when no ready RAG documents exist.
- Confirm local UI-only mode still bypasses real Pinecone calls.

Suggested automated tests:

- Provider selection unit tests.
- Pinecone status mapping tests.
- Firestore mapper tests for new nullable fields.
- Route tests with mocked Pinecone client:
  - upload success
  - upload failure
  - status sync
  - chat fallback without documents
  - Pinecone chat path with ready documents
  - delete file cleanup

## Rollout Plan

1. Add env vars and docs.
2. Add Pinecone client wrapper with mocked tests.
3. Extend Firestore types/mappers for Pinecone fields.
4. Add provider switch while keeping legacy path.
5. Convert new uploads to Pinecone Assistant behind `RAG_PROVIDER=pinecone-assistant`.
6. Update UI status handling.
7. Convert chat route to Pinecone Assistant when ready Pinecone documents exist.
8. Validate per-user isolation in staging.
9. Enable production for a small test account.
10. Monitor upload failures, processing time, chat errors, and citation quality.
11. Decide whether to migrate existing legacy records.
12. Remove `pdfjs-dist`, Upstash Vector code, and legacy chunk collections only after migration is complete.

## Open Questions

- Should we use one assistant per user, or can Pinecone Assistant chat be safely scoped to a subset of files per request?
- Which file types must remain supported on day one: PDF only, or PDF plus TXT/MD/JSON/CSV/XLSX?
- Do we need to retain original files in Firebase Storage after Pinecone upload?
- Should the selected chat model still matter when Pinecone Assistant is answering?
- How should citations be rendered in the current chat UI?
- Should document-grounded chat be automatic when ready documents exist, or controlled by a UI toggle?

## Recommended First PR Scope

First PR should be provider groundwork, not full cutover:

- Add `docs/rag-pinecone-assistant.md`.
- Add env docs to `.env.example` and `docs/setup.md`.
- Add `RagDocument` Pinecone fields and Firestore mapper support.
- Add `lib/rag/provider.ts`.
- Add `lib/rag/pinecone-assistant.ts` with upload/status/delete/chat wrappers.
- Add mocked unit coverage for provider/status behavior if the current test setup supports it.

Second PR:

- Switch upload/list/delete flows for new records.
- Update UI polling/status display.

Third PR:

- Switch chat route to Pinecone Assistant for users with ready Pinecone documents.
- Add citation rendering or text fallback.

Fourth PR:

- Data migration and legacy cleanup decisions.
