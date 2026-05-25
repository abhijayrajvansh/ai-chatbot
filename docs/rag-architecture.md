# RAG Architecture (Implemented in Code)

This document describes the RAG architecture currently implemented in this repository.

Current production target: set `RAG_PROVIDER=pinecone-assistant` to use Pinecone Assistant for managed document parsing, indexing, retrieval, and document-grounded chat. The legacy custom pipeline remains available with `RAG_PROVIDER=legacy-custom`.

## Scope

- Chat API orchestration: `app/(chat)/api/chat/route.ts`
- RAG document upload/list/delete API: `app/(chat)/api/rag-documents/route.ts`
- RAG worker API: `app/(chat)/api/rag-documents/process/route.ts`
- Ingestion pipeline: `lib/rag/ingest.ts`, `lib/rag/worker.ts`
- Queue: `lib/rag/queue.ts`
- Vector search + embeddings: `lib/rag/vector.ts`
- Retrieval + formatting: `lib/rag/retrieval.ts`
- Storage: `lib/rag/storage.ts`
- Persistence: `lib/db/queries.ts`, `lib/firebase/*`

## Technologies Used

- App/API runtime: Next.js App Router route handlers
- Authentication: Firebase client SDK sign-in with server-side Firebase ID token verification via `auth()`
- Metadata DB: Cloud Firestore
- File storage: Firebase Storage
- Queue:
- Primary: Upstash Redis REST (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`)
- Fallback: Redis TCP client via `REDIS_URL`
- Embeddings: LangChain `OpenAIEmbeddings` (`@langchain/openai`)
- Vector DB: Upstash Vector (`@upstash/vector`)
- Chat model orchestration: LangChain chat models
- `ChatOpenAI` (`@langchain/openai`)
- `ChatAnthropic` (`@langchain/anthropic`)
- `ChatGoogleGenerativeAI` (`@langchain/google-genai`)

## Step-by-Step Flow

### 1) Upload entrypoint (`POST /api/rag-documents`)

1. Requires authenticated user unless `LOCAL_UI_ONLY/NEXT_PUBLIC_UI_ONLY` mode is active.
2. Validates file:
- max size 50 MB
- MIME types: PDF, XLS/XLSX, TXT, MD, CSV, JSON
3. Computes SHA-256 checksum (`getRagFileChecksum`) for dedup.
4. If same-user checksum exists and status is `ready`, returns existing document (`deduplicated: true`).
5. Creates Firestore `rag_documents` record with initial status `queued`.
6. Uploads file to Firebase Storage at `rag/{userId}/{ragDocumentId}/{timestamp}-{safeName}`.
7. Updates `rag_documents.storagePath`.
8. Enqueues ingest job to Redis queue.
9. If queue unavailable:
- falls back to inline ingest in the same request.
10. If queue is available:
- still triggers best-effort immediate background processing via `processRagIngestJob(...)` (non-blocking), in addition to queueing.

### 2) Queue and worker execution (`POST /api/rag-documents/process`)

1. Accepts auth in either of two ways:
- authenticated user session, or
- valid `x-rag-worker-secret` matching `RAG_WORKER_SECRET`.
2. Dequeues up to `limit` jobs (default `2`) from `RAG_QUEUE_NAME` (default `rag-index-jobs`).
3. For each job:
- user-scoped safety check when called by session user (re-queues jobs that belong to other users)
- executes `processRagIngestJob`.
4. Retry behavior:
- worker marks retryable failures back to `queued` and caller re-enqueues.
- non-retryable failures become `failed`.

### 3) Ingestion internals (`lib/rag/worker.ts` + `lib/rag/ingest.ts`)

1. Worker loads `rag_documents` record and increments `attempts`.
2. Status set to `processing` with `processingStartedAt`.
3. Downloads file bytes from Firebase Storage.
4. Extracts text by MIME:
- PDF: `pdfjs-dist` (page-by-page extraction)
- XLS/XLSX: `xlsx` sheet-to-CSV conversion
- CSV: `papaparse`
- TXT/MD/JSON: UTF-8 decode/trim
5. Chunks text via `chunkText`:
- defaults: `RAG_CHUNK_SIZE=1200`, `RAG_CHUNK_OVERLAP=180`
- paragraph-aware; long paragraphs are sliding-window chunked
- PDF stores `pageNumber` per chunk
6. Saves full source doc in Firestore `documents` and also writes lexical chunks in Firestore `document_chunks` (used for retrieval fallback).
7. Embeds chunks using LangChain `OpenAIEmbeddings`:
- model: `OPENAI_EMBEDDING_MODEL` (default `text-embedding-3-small`)
- key/base URL source:
  - `LLM_API_KEY` + optional `LLM_BASE_URL`, else
  - `OPENAI_API_KEY` + optional `OPENAI_BASE_URL`
8. Upserts vectors into Upstash Vector.
9. Updates `rag_documents` to `ready` with `chunkCount`, `readyAt`.
10. On failure:
- error code mapping: `extract_failed`, `embed_failed`, `index_failed`
- retries for `extract_failed` and `embed_failed` until `RAG_MAX_RETRIES` (default `3`)
- backoff based on `RAG_RETRY_BASE_MS` (default `500`)

### 4) Vector schema (`lib/rag/vector.ts`)

- Vector id format: `${userId}:${documentId}:${chunkIndex}`
- Vector metadata:
- `userId`
- `documentId`
- `documentTitle`
- `documentKind`
- `chunkIndex`
- optional `pageNumber`
- Stored vector payload data: raw chunk text

### 5) Retrieval at chat time (`POST /api/chat`)

1. Chat API obtains latest user query text.
2. Calls `getRelevantContextForUser({ userId, query })`.
3. Retrieval path:
- tries vector search first via Upstash Vector + query embedding
- candidate depth uses `RAG_RETRIEVAL_CANDIDATE_K` with internal safe expansion (`max(limit*8, 24)`)
- filters results by `metadata.userId`
- applies lexical guardrail: token-overlap threshold (`>= 2`) before accepting semantic hits
4. If vector unavailable or no vector hits:
- falls back to Firestore `document_chunks` token-overlap scoring.
5. Formats selected chunks (`RAG_TOP_K`, default `6`) into prompt context with document title, chunk index, and page number (if available).
6. Injects context into system prompt (`systemPrompt`) with explicit citation instructions.
7. Sends final prompt to LangChain chat model and streams response to client.

## Chat Model Configuration (LLMs in this app)

- UI-listed chat model in current config: `openai/gpt-4.1-mini` (`lib/llm/models.ts`)
- Runtime chat adapter supports provider prefixes:
- `openai/*` via `ChatOpenAI`
- `anthropic/*` via `ChatAnthropic`
- `google/*` via `ChatGoogleGenerativeAI`
- OpenAI-compatible custom endpoint is also supported through:
- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL` (for `openai/custom`)

## Firestore Data Surfaces Used by RAG

- `rag_documents`:
- lifecycle/status and ingestion metadata
- `documents`:
- full extracted text per ingested document id
- `document_chunks`:
- chunked text for lexical fallback retrieval

## `rag_documents` Lifecycle

- `queued -> processing -> ready`
- `queued -> processing -> queued` (retry path)
- `queued -> processing -> failed`

Tracked fields include:
- `status`, `error`, `errorCode`
- `attempts`
- `checksum`, `storagePath`, `chunkCount`, `embeddingModel`
- `queuedAt`, `processingStartedAt`, `readyAt`, `failedAt`

## Queue Payload

Each queue item contains:
- `jobId`
- `ragDocumentId`
- `userId`
- `documentId`
- `storagePath`
- `mimeType`
- `checksum`
- `enqueuedAt`

## Deletion Flow (`DELETE /api/rag-documents`)

For selected docs (`single`, `failed`, or `all`):
1. Delete vectors in Upstash Vector by prefix `${userId}:${documentId}:` (best-effort).
2. Delete file from Firebase Storage (if `storagePath` exists).
3. Delete Firestore `rag_documents`, plus associated `documents` and `document_chunks`.

## Required and Optional Environment Variables

Core vector RAG:
- `UPSTASH_VECTOR_REST_URL`
- `UPSTASH_VECTOR_REST_TOKEN`
- `OPENAI_EMBEDDING_MODEL` (default `text-embedding-3-small`)
- embedding auth:
  - `OPENAI_API_KEY` (or)
  - `LLM_API_KEY` (with optional `LLM_BASE_URL`)

Queue:
- preferred: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- fallback: `REDIS_URL` (`redis://...`)
- optional: `RAG_QUEUE_NAME`

Worker/retry tuning:
- `RAG_WORKER_SECRET`
- `RAG_MAX_RETRIES`
- `RAG_RETRY_BASE_MS`
- `RAG_RETRIEVAL_CANDIDATE_K`
- `RAG_TOP_K`
- `RAG_CHUNK_SIZE`
- `RAG_CHUNK_OVERLAP`

## Operational Notes

## Steps Summary

- Step 1: `POST /api/rag-documents` validates file, deduplicates by checksum, saves metadata, uploads to Firebase Storage, and queues/starts ingestion.
- Step 2: `POST /api/rag-documents/process` dequeues jobs from Redis and runs authenticated worker processing with retry handling.
- Step 3: Worker downloads from Firebase Storage, extracts text, chunks content, stores Firestore document/chunks, embeds with LangChain, and upserts Upstash Vector.
- Step 4: Vectors are stored as `${userId}:${documentId}:${chunkIndex}` with metadata for user/document/page-aware retrieval.
- Step 5: `POST /api/chat` retrieves context (vector-first, lexical fallback), injects it into the system prompt, and streams LLM output.
- Step 6: `DELETE /api/rag-documents` removes vector entries, storage file, and Firestore RAG/document chunk records.

- RAG index writes are user-isolated and retrieval re-filters by `userId`.
- Vector search is optional; if disabled/misconfigured, lexical fallback still works using Firestore `document_chunks`.
- `POST /api/rag-documents/process` is designed for cron/worker invocation in production with `x-rag-worker-secret`.
