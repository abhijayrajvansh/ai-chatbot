# Chatbot Architecture

This app is a Next.js chatbot template built around the AI SDK UI transport, LangChain orchestration, Firebase Authentication, Cloud Firestore persistence, and Firebase Storage.

## High-Level Stack

| Area | Technology |
| --- | --- |
| Web framework | Next.js 16 App Router |
| UI runtime | React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS 4, shadcn-style components, Radix UI primitives |
| AI runtime | AI SDK 6 UI transport, `@ai-sdk/react`, LangChain providers |
| Auth | Firebase Authentication |
| Database | Cloud Firestore |
| File storage | Firebase Storage |
| Cache/rate limit/stream resume | Redis |
| Rich text/code rendering | Streamdown, Shiki, KaTeX, Mermaid plugins |
| Editors/artifacts | CodeMirror, ProseMirror, React Data Grid, Pyodide |
| Validation | Zod |
| Tests/checks | Playwright, TypeScript, Ultracite/Biome |

## App Router Structure

The app is organized by route groups:

```text
app/
  (chat)/
    page.tsx
    layout.tsx
    chat/[id]/page.tsx
    api/
      chat/route.ts
      history/route.ts
      messages/route.ts
      files/upload/route.ts
      models/route.ts
      document/route.ts
      suggestions/route.ts
      vote/route.ts
  (auth)/
    auth.ts
    actions.ts
    login/page.tsx
    api/auth/logout/route.ts
    api/auth/session/route.ts
```

`app/(chat)/layout.tsx` renders the main application shell: sidebar, active chat provider, toast system, and chat surface.

`app/(auth)/auth.ts` verifies Firebase session cookies and exposes the server-side session helper.

`proxy.ts` protects routes by checking for the Firebase session cookie and redirecting unauthenticated users to `/login`. In local UI-only mode, this proxy allows requests through without auth.

## Client Chat Flow

The main chat UI starts in:

```text
components/chat/shell.tsx
```

Important client pieces:

- `ChatShell` composes header, message list, input box, artifact panel, and stream handler.
- `ActiveChatProvider` in `hooks/use-active-chat.tsx` owns the active chat ID, messages, model selection, visibility, and AI SDK chat hook.
- `MultimodalInput` handles text input, image uploads, model selection, and submit behavior.
- `Messages` and `Message` render user/assistant messages and tool output.
- `DataStreamProvider` and `DataStreamHandler` process custom stream events for titles and artifacts.

When the user sends a message:

1. `MultimodalInput` calls `sendMessage`.
2. `useChat` from `@ai-sdk/react` sends the request through `DefaultChatTransport`.
3. The request goes to `POST /api/chat`.
4. The server streams AI SDK UI message chunks back to the client.
5. The message list updates as chunks arrive.
6. Custom stream parts update chat title and artifact state.

## Server Chat Flow

The main chat endpoint is:

```text
app/(chat)/api/chat/route.ts
```

In full mode it performs:

1. Parse and validate the request body with Zod.
2. Check auth session.
3. Validate selected model against `lib/ai/models.ts`.
4. Apply IP rate limiting through Redis in production.
5. Check per-user message entitlement.
6. Load existing chat and messages from Firestore.
7. Save new chat/message records when needed.
8. Build model messages with the AI SDK.
9. Build LangChain messages with retrieved document context.
10. Invoke the configured chat model through LangChain.
11. Persist finished assistant messages.
12. Optionally create resumable streams when Redis is configured.

In UI-only mode, this route returns a local mock streamed response and skips auth, database, Redis, Blob, and LLM calls.

## AI Model Layer

Model configuration lives in:

```text
lib/ai/models.ts
lib/ai/providers.ts
```

`lib/ai/models.ts` defines:

- default chat model
- title-generation model
- curated model list
- model capabilities
- provider availability based on environment variables

`lib/ai/providers.ts` selects either:

- mock models in test mode
- LangChain chat provider wrappers in normal mode

The app uses the AI SDK primitives:

- `useChat` on the client
- `DefaultChatTransport` for client/server communication
- `createUIMessageStream` and `createUIMessageStreamResponse` for UI-compatible streaming
- LangChain chat models for chat, title generation, and document generation

## AI Tools

Tool definitions live in:

```text
lib/ai/tools/
```

Available tools include:

- `get-weather`
- `create-document`
- `edit-document`
- `update-document`
- `request-suggestions`

These tools let the model create and modify artifacts, fetch weather, and generate suggestions. Tool outputs are streamed back to the client through custom data parts.

## Artifacts System

Artifacts are side-panel documents generated or edited by the model.

Key files:

```text
components/chat/artifact.tsx
components/chat/create-artifact.tsx
lib/artifacts/server.ts
artifacts/text/
artifacts/code/
artifacts/image/
artifacts/sheet/
```

Artifact kinds:

- `text`
- `code`
- `image`
- `sheet`

Client artifact handlers listen for stream parts such as text/code/sheet/image deltas. Server artifact handlers generate or update content using AI SDK streaming.

The code artifact can use Pyodide in the browser for Python execution.

## Persistence Layer

The database schema lives in:

```text
lib/db/schema.ts
```

Tables:

- `User`
- `Chat`
- `Message_v2`
- `Vote_v2`
- `Document`
- `Suggestion`
- `Stream`

Queries live in:

```text
lib/db/queries.ts
```

Firestore does not require SQL migrations. This command is retained as a no-op for deployment scripts:

```bash
pnpm db:migrate
```

## Auth Layer

Auth is powered by Firebase Authentication with a server-side Firebase session cookie.

Key files:

```text
app/(auth)/auth.ts
app/(auth)/actions.ts
app/(auth)/api/auth/session/route.ts
app/(auth)/api/auth/logout/route.ts
proxy.ts
```

Auth providers:

- Firebase email/password login for regular users

Users are mirrored into Firestore on sign-in so chat ownership and history queries use the same user id as Firebase Auth.

## Storage Layer

Image upload route:

```text
app/(chat)/api/files/upload/route.ts
```

Full mode uses Firebase Storage through the Firebase Admin SDK.

UI-only mode returns a local `data:` URL so the frontend can still preview upload behavior without Firebase Storage.

## Redis Usage

Redis is used in two places:

- `lib/ratelimit.ts` for production IP rate limiting
- `app/(chat)/api/chat/route.ts` for resumable stream IDs

The app skips Redis behavior when `REDIS_URL` is absent, so Redis is recommended for production but not required for local UI preview.

## Rendering and UI Libraries

The UI uses:

- Tailwind CSS for layout and theme tokens
- Radix UI primitives for accessible menus, dialogs, popovers, dropdowns, and sidebar behavior
- lucide-react icons
- Streamdown for streamed markdown rendering
- Shiki for code highlighting
- KaTeX and Mermaid support through Streamdown plugins
- Sonner for toast notifications
- Framer Motion / Motion for animated UI

Reusable UI primitives are in:

```text
components/ui/
```

Chat-specific components are in:

```text
components/chat/
```

AI rendering primitives are in:

```text
components/ai-elements/
```

## Local UI-Only Bypass

This repo now includes:

```text
lib/local-mode.ts
```

When either of these env vars is set to `1`:

```env
LOCAL_UI_ONLY=1
NEXT_PUBLIC_UI_ONLY=1
```

The app bypasses:

- auth redirects
- session lookup in chat layout
- database-backed history/messages
- Blob uploads
- LLM calls
- model capability network fetches
- server actions that require persisted chats

This mode is only for viewing and testing the UI. It is not a replacement for real production setup.

## Request Lifecycle Summary

Full chat request:

```text
Browser
  -> ChatShell / useActiveChat
  -> AI SDK useChat
  -> POST /api/chat
  -> Firebase session check
  -> Firestore chat/message lookup
  -> Redis rate limit in production
  -> LangChain model invocation
  -> Firestore document retrieval for RAG
  -> Firestore persistence
  -> Streamed UI message response
  -> React message/artifact updates
```

UI-only chat request:

```text
Browser
  -> ChatShell / useActiveChat
  -> AI SDK useChat
  -> POST /api/chat
  -> local mock stream
  -> React message updates
```
