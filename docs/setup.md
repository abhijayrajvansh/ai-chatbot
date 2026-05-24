# Chatbot Setup Guide

## Setup Modes

| Mode | Purpose | External services required |
| --- | --- | --- |
| UI preview mode | View and click through the chatbot UI without real auth, database, uploads, Redis, or AI calls. | None |
| Full working mode | Use Firebase auth, Firestore persistence, Firebase Storage uploads, streaming model responses, and production behavior. | Firebase, a configured LLM provider, and optionally Redis |

For UI preview only:

```env
LOCAL_UI_ONLY=1
NEXT_PUBLIC_UI_ONLY=1
```

Remove those flags for full working mode.

## Firebase Environment

Use these names in `.env.local`:

```env
NEXT_PUBLIC_DATABASE_ENV=brackets

NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=
NEXT_PUBLIC_FIREBASE_DATABASE_URL=

FIREBASE_SERVICE_ACCOUNT_TYPE=service_account
FIREBASE_SERVICE_ACCOUNT_PROJECT_ID=
FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY_ID=
FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY=
FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL=
FIREBASE_SERVICE_ACCOUNT_CLIENT_ID=
FIREBASE_SERVICE_ACCOUNT_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_SERVICE_ACCOUNT_TOKEN_URI=https://oauth2.googleapis.com/token
FIREBASE_SERVICE_ACCOUNT_AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
FIREBASE_SERVICE_ACCOUNT_CLIENT_X509_CERT_URL=
FIREBASE_SERVICE_ACCOUNT_UNIVERSE_DOMAIN=googleapis.com
```

`NEXT_PUBLIC_DATABASE_ENV` selects the Firestore database ID (`default`, `brackets`, `production`).
Collections are unprefixed and stored as `users`, `chats`, `messages`, `documents`, etc.

## LLM Provider

Configure one provider that the LangChain adapter can use:

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=
GOOGLE_API_KEY=
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
```

The app activates whichever model providers are available in env and uses LangChain for chat, title generation, and document RAG.

## Upstash Vector (RAG Embeddings)

To enable vector-based retrieval for uploaded RAG documents, configure:

```env
UPSTASH_VECTOR_REST_URL=
UPSTASH_VECTOR_REST_TOKEN=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

Notes:
- Embeddings use `LLM_API_KEY`/`OPENAI_API_KEY` and optional `LLM_BASE_URL`/`OPENAI_BASE_URL`.
- If Upstash vector variables are missing, retrieval falls back to token-overlap matching on stored chunks.

## Redis

Redis remains optional and is only used for production rate limiting and resumable chat streams:

```env
REDIS_URL=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

For asynchronous RAG indexing queues, prefer Upstash Redis (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) or configure `REDIS_URL` with a worker-compatible queue client.

## Run

```bash
pnpm install
pnpm dev
```

Firestore does not require SQL migrations. `pnpm db:migrate` is now a no-op.
