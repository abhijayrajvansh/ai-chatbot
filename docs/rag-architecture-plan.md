# RAG Architecture (Current Implementation)

This document explains the RAG pipeline that is currently implemented in this repo.

## Goal

Turn uploaded user files into searchable knowledge, then use that knowledge to answer chat questions.

## Stack Used

- Storage: Firebase Storage
- Metadata/status: Firestore (`rag_documents`)
- Queue: Upstash Redis REST (preferred), with optional TCP Redis fallback
- Chunk embeddings: OpenAI embeddings via LangChain `OpenAIEmbeddings`
- Vector DB: Upstash Vector
- Chat retrieval path: Next.js API route + RAG context injection

## End-to-End Flow

### 1) User uploads a document

Route: `POST /api/rag-documents`

What happens:
1. Validate file type and size.
2. Compute checksum for deduplication.
3. If same checksum already exists and is `ready`, return existing doc.
4. Save a Firestore `rag_documents` record with `status=queued`.
5. Upload original file to Firebase Storage (`storagePath` saved in Firestore).
6. Push an ingest job to Redis queue.

If queue is unavailable:
- API falls back to inline ingest so upload still works.

### 2) Worker processes queued jobs

Route: `POST /api/rag-documents/process`

What happens:
1. Pop jobs from queue (`RAG_QUEUE_NAME`).
2. Mark doc `processing` and increment `attempts`.
3. Download file from Firebase Storage.
4. Extract text by MIME type:
   - PDF: `pdfjs-dist`
   - XLS/XLSX: `xlsx`
   - CSV: `papaparse`
   - TXT/MD/JSON: plain text decode
5. Chunk text using `chunkText`.
6. Embed chunks with `OpenAIEmbeddings` (`OPENAI_EMBEDDING_MODEL`).
7. Upsert vectors to Upstash Vector.
8. Mark Firestore record `ready` with `chunkCount`.

On failure:
- Save `error` + `errorCode`.
- Retry until `RAG_MAX_RETRIES`.
- Mark `failed` when retries are exhausted.

### 3) Retrieval during chat

Route: `POST /api/chat`

What happens:
1. Read latest user message.
2. Create query embedding.
3. Query Upstash Vector with candidate limit (`RAG_RETRIEVAL_CANDIDATE_K`, with safe defaults).
4. Filter by `userId` for data isolation.
5. Select top context chunks (`RAG_TOP_K`).
6. Inject context into system prompt.
7. Generate final response from chat model.

Fallback behavior:
- If vector search is disabled/unavailable, retrieval falls back to token-overlap scoring on stored chunks.

## Firestore `rag_documents` lifecycle

Status transitions:
- `queued -> processing -> ready`
- `queued -> processing -> failed`
- `queued -> processing -> queued` (retry path)

Important fields tracked:
- `status`, `error`, `errorCode`
- `attempts`
- `queuedAt`, `processingStartedAt`, `readyAt`, `failedAt`
- `storagePath`, `checksum`, `chunkCount`, `embeddingModel`

## Queue Payload

Each queued job includes:
- `jobId`
- `ragDocumentId`
- `userId`
- `documentId`
- `storagePath`
- `mimeType`
- `checksum`
- `enqueuedAt`

## Vector Schema

Vector id:
- `${userId}:${documentId}:${chunkIndex}`

Vector metadata:
- `userId`
- `documentId`
- `documentTitle`
- `documentKind`
- `chunkIndex`

## Required Environment Variables

Core RAG:
- `UPSTASH_VECTOR_REST_URL`
- `UPSTASH_VECTOR_REST_TOKEN`
- `OPENAI_EMBEDDING_MODEL` (default `text-embedding-3-small`)
- `OPENAI_API_KEY` or `LLM_API_KEY`

Queue (preferred):
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Queue fallback (optional):
- `REDIS_URL` (must be `redis://...`)

Tuning:
- `RAG_QUEUE_NAME`
- `RAG_TOP_K`
- `RAG_RETRIEVAL_CANDIDATE_K`
- `RAG_CHUNK_SIZE`
- `RAG_CHUNK_OVERLAP`
- `RAG_MAX_RETRIES`
- `RAG_RETRY_BASE_MS`
- `RAG_WORKER_SECRET` (recommended for secure worker endpoint)

## Operational Notes

- RAG documents page polls status and can trigger processing route while docs are pending.
- For production, schedule `POST /api/rag-documents/process` via cron with `x-rag-worker-secret`.
- User data isolation is enforced in retrieval by `userId` filtering.
