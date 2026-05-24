# RAG Architecture Plan (Upstash Vector + LangChain)

## 1) Why uploads are failing right now

Current failure:
- `Setting up fake worker failed... pdf.worker.mjs not found` when uploading PDF.

Root cause:
- The current ingestion uses `pdf-parse` in the Next.js route runtime.
- `pdf-parse` (v2+) relies on `pdfjs-dist` worker assets that Turbopack/Next server chunks are not reliably bundling in this setup.
- This is a runtime/tooling mismatch, not a RAG logic issue.

Impact:
- PDF text extraction fails before chunking/embedding.
- Upload endpoint returns `500`, and the client reports `Failed to process request`.

---

## 2) Target RAG behavior (product contract)

For each user:
1. User uploads document(s): PDF, DOCX/TXT/MD/CSV/XLS/XLSX/JSON.
2. System extracts clean text per document.
3. System chunks text with stable chunk IDs.
4. System embeds chunks with configured embedding model.
5. System upserts embeddings + metadata to Upstash Vector.
6. User asks a chat question.
7. System embeds query, performs vector retrieval with user-scoped filtering.
8. System builds context from top chunks and answers via chat model.
9. System returns answer plus optional citations/chunk sources.

---

## 3) Recommended technical design

### 3.1 Storage model

Keep two layers:

1. **Metadata store (Firestore)**
- `rag_documents` collection
- Tracks document-level ingest lifecycle and status.

2. **Vector store (Upstash Vector)**
- One vector per chunk.
- Metadata includes `userId`, `documentId`, `chunkIndex`, `title`, `mimeType`, `checksum`, `ingestedAt`.

### 3.2 Firestore schema (proposed)

`rag_documents/{id}`
- `id: string`
- `userId: string`
- `fileName: string`
- `mimeType: string`
- `size: number`
- `checksum: string` (dedupe / re-ingestion guard)
- `status: "queued" | "processing" | "ready" | "failed"`
- `chunkCount: number`
- `embeddingModel: string`
- `vectorNamespace: string`
- `error: string | null`
- `createdAt: Date`
- `updatedAt: Date`

Optional audit collection:
- `rag_document_jobs` for per-step timestamps and retry counters.

### 3.3 Upstash vector keying

Vector ID format:
- `${userId}:${documentId}:${chunkIndex}`

Metadata:
- `userId`
- `documentId`
- `chunkIndex`
- `documentTitle`
- `mimeType`
- `checksum`
- `ingestedAt`

Namespace strategy:
- Option A: one global namespace + metadata filter by `userId`.
- Option B: namespace per user (can simplify isolation).

Recommendation now:
- Start with global namespace + `userId` metadata filter and strict post-filtering in app.

---

## 4) Document ingestion pipeline (step-by-step)

### Step A: Upload acceptance
- Validate file size/type at API boundary.
- Store original file in Firebase Storage (or temp object store).
- Create Firestore doc with `status=queued`.

### Step B: Text extraction
- Parse by MIME type using dedicated loaders:
  - PDF: `pdfjs-dist` direct extraction (without fake worker dependency in Next route) or move parsing to background worker/service.
  - XLS/XLSX: `xlsx` sheet-to-text table serialization.
  - TXT/MD/CSV/JSON: plain/textual parsing with normalization.

Important:
- Normalize whitespace/newlines.
- Preserve section boundaries where possible.

### Step C: Chunking
- Use deterministic splitter:
  - `RecursiveCharacterTextSplitter` (LangChain) or current chunker with overlap.
- Suggested defaults:
  - chunk size: 800-1200 chars
  - overlap: 120-200 chars
- Store chunk count and chunk hash list.

### Step D: Embedding
- Use one embedding model consistently (default: `text-embedding-3-small`).
- Batch embeddings to avoid rate limit spikes.
- Retry with exponential backoff for transient provider errors.

### Step E: Vector upsert
- Upsert all chunk vectors to Upstash.
- Validate count match: `upserted == chunkCount`.
- Update Firestore status to `ready` on success.

### Step F: Failure handling
- If any step fails:
  - `status=failed`
  - persist machine-readable `error`
  - allow manual retry from UI.

---

## 5) Retrieval pipeline (chat time)

1. Build query from latest user message.
2. Embed query with same embedding model used at ingest.
3. Query Upstash with `topK` (start with 20-30 raw).
4. Enforce user isolation:
  - metadata filter where supported.
  - always app-side filter by `userId` as safety net.
5. Rerank/select final `k` chunks (e.g., top 6).
6. Construct prompt context blocks with title/chunk index.
7. Generate answer with citations.
8. If no relevant chunks:
  - respond clearly that no supporting document context was found.

---

## 6) LangChain integration plan

### Ingestion side
- Use LangChain text splitters for robust chunking.
- Use `OpenAIEmbeddings` for vector generation.
- Keep adapter boundaries in:
  - `lib/rag/ingest.ts`
  - `lib/rag/vector.ts`

### Retrieval side
- Keep retrieval in `lib/rag/retrieval.ts`.
- Add reranking hook (future):
  - cross-encoder reranker or model-based rerank.

### Prompting
- Keep `systemPrompt` RAG context bounded (token budget).
- Add citation formatting contract:
  - `[Doc: <title> | Chunk: <n>]`

---

## 7) Immediate fixes required before continuing implementation

1. Replace current PDF extraction path.
- Do not use the current `pdf-parse` runtime path in Next route handlers.
- Preferred:
  - move PDF extraction to a background worker process, or
  - use `pdfjs-dist` server parsing with explicit worker-free config compatible with Next runtime.

2. Add explicit ingestion status model.
- Current flow assumes immediate success.
- Must track `queued/processing/ready/failed`.

3. Add robust API error contract.
- API should return step-specific errors (`extract_failed`, `embed_failed`, etc.) not generic `Failed to process request`.

4. Add idempotency and dedupe.
- Use file checksum + userId to avoid duplicate indexing.

---

## 8) Implementation phases

### Phase 1: Stabilize ingestion core
- Introduce ingestion status tracking.
- Swap PDF parser to a Next-compatible strategy.
- Keep upload synchronous for now but with clear step-level errors.

### Phase 2: Productionize indexing
- Move ingestion to async/background job.
- Add retry/backoff and dead-letter status.
- Add observability metrics (time per step, failure rate).

### Phase 3: Retrieval quality
- Add reranking.
- Add query rewriting (optional).
- Add answer citations in UI.

### Phase 4: Management UX
- RAG docs page shows per-document status, chunk count, updated time.
- Add delete/reindex actions.
- Add “last indexed with model X”.

---

## 9) Required environment variables

- `UPSTASH_VECTOR_REST_URL`
- `UPSTASH_VECTOR_REST_TOKEN`
- `OPENAI_API_KEY` or `LLM_API_KEY`
- `OPENAI_EMBEDDING_MODEL` (default `text-embedding-3-small`)

Optional but recommended:
- `RAG_TOP_K`
- `RAG_CHUNK_SIZE`
- `RAG_CHUNK_OVERLAP`

---

## 10) Acceptance criteria

A document is considered successfully indexed only if:
1. Text extraction succeeds.
2. Chunk count > 0.
3. Embeddings generated for all chunks.
4. All chunk vectors upserted.
5. Firestore document status becomes `ready`.

A chat answer is considered RAG-grounded only if:
1. Retrieval returns chunks from current user scope.
2. Prompt contains those chunks.
3. Response includes citations or explicit no-context fallback.

---

## 11) Current repo gap summary

What exists now:
- Upstash vector client integration.
- Chunking and embedding path.
- Basic RAG upload/list page and route.

What is missing/weak:
- PDF extraction compatibility in Next runtime.
- Job lifecycle and status tracking.
- Reliable step-level errors and retries.
- De-duplication/idempotency.
- Citation-first answer UX.

