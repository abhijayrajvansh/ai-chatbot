# AGENTS.md
This is the primary operating guide for AI coding agents working in this repository.

## Overview
- This repository is a production-style Next.js chatbot application (`chatbot` v3.1.0) using App Router, TypeScript, React 19, and AI SDK + LangChain.
- Backend services are Firebase Authentication, Cloud Firestore, and Firebase Storage, with optional Redis for production rate limiting and resumable streams.
- Primary package manager is `pnpm` (`packageManager: pnpm@10.32.1`).
- This document is the default policy baseline for agent work in this repo.

## Golden Rules
- Always use `pnpm` for package and script commands.
- Never start the dev server locally.
- Do not run build or lint unless explicitly requested.
- Always type-check after any code change and fix all TypeScript errors.

## Linear MCP (Mandatory)
- Not used in this repo.
- If Linear workflow is introduced later, use MCP-based Linear operations and context lookup first.

## Always After Changes (Mandatory)
- Run: `pnpm exec tsc --noEmit` and resolve all errors.
- Execute post-task GitOps checklist from `.github/gitops.md` before handoff (`verify in repo`; file not present at time of writing).
- Stage, commit, and push every completed task.
- Commit format must enforce: `git commit -m "feat: <6–7 word summary>"` as canonical example.

## Development Constraints
- Use `pnpm` only. Do not use `npm`, `yarn`, or `bun`.
- Never run `pnpm dev` unless explicitly requested by the repository owner.
- Do not run `pnpm build`, `pnpm check`, `pnpm fix`, or other lint/build workflows unless explicitly requested.
- Keep changes minimal, targeted, and consistent with existing patterns.
- Preserve local UI-only behavior flags (`LOCAL_UI_ONLY=1`, `NEXT_PUBLIC_UI_ONLY=1`) when working on UI-only flows.
- Treat missing operational docs/templates as required follow-up (`verify in repo`) rather than silently skipping.

## Tech Stack
- Framework: Next.js 16 (App Router)
- Language: TypeScript (strict mode enabled)
- UI: React 19, Tailwind CSS 4, Radix UI, shadcn-style components
- AI runtime: AI SDK 6 (`ai`, `@ai-sdk/react`), LangChain adapters
- Auth: Firebase Authentication with server-side session cookie (`firebase_session`)
- Database: Cloud Firestore (namespaced collections via `NEXT_PUBLIC_DATABASE_ENV`)
- Storage: Firebase Storage (upload route + signed token URL)
- Optional infra: Redis (`REDIS_URL`) for production IP rate limiting + resumable streams
- Tooling: Playwright E2E, Biome/Ultracite, TypeScript compiler
- Deploy target: Vercel (repo includes `vercel.json`)

## Architecture
- Route groups:
- `app/(chat)` for authenticated chat UI and API routes.
- `app/(auth)` for login/session/logout flows.
- Request protection and redirects are enforced in `proxy.ts` using Firebase session cookie checks.
- Chat API entrypoint is `app/(chat)/api/chat/route.ts`:
- Validates request with Zod schema.
- Enforces auth in full mode.
- Enforces rate limits and per-user entitlement limits.
- Loads/saves chats/messages in Firestore.
- Retrieves RAG context and invokes LangChain chat models.
- Streams responses through AI SDK UI message stream.
- Local UI-only mode bypasses auth/DB/provider calls and returns mocked stream output.
- Persistence is implemented in `lib/db/queries.ts` with Firestore collection wrappers from `lib/firebase/collections.ts`.

## Code Style
- Use TypeScript-first, strict-safe patterns; avoid weakening types to bypass compiler checks.
- Follow existing App Router conventions and file organization.
- Prefer existing utilities and modules (`lib/*`, `hooks/*`, `components/*`) over duplicate logic.
- Validate inbound API payloads with Zod where applicable.
- Keep server-only logic in server contexts (`server-only`, route handlers, server actions).
- Do not introduce new formatting/lint tools; repo uses Biome/Ultracite configuration already.

## Git Workflow
- Use git CLI only.
- Never use `git commit -a`.
- Stage explicitly with `git add <file>`.
- Use commit types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`.
- Keep commit summaries short (~6–7 words).
- Canonical commit example: `git commit -m "feat: <6–7 word summary>"`.
- Push after commit.
- Standard task closeout sequence:
- `pnpm exec tsc --noEmit`
- Run `.github/gitops.md` checklist (`verify in repo` if missing)
- `git add <files>`
- `git commit -m "<type>: <6–7 word summary>"`
- `git push`

## Pull Request Guidelines (On Request Only)
- Create PRs only when explicitly requested.
- Default PR target branch: `dev`.
- Ensure clean typecheck before PR creation: `pnpm exec tsc --noEmit`.
- Run build only when PR creation is explicitly requested.
- Use project PR template if present (example path: `.github/pr-template.md`; verify in repo).
- Write concise PR title/body based on actual branch commits.

## Project Structure
- `app/`: Next.js App Router routes, layouts, and API handlers.
- `components/`: UI primitives and chat/auth feature components.
- `hooks/`: Client hooks for chat state, stream handling, and UI behavior.
- `lib/`: Core runtime modules (AI providers/models/tools, Firebase, DB queries, RAG, rate limiting).
- `artifacts/`: Artifact generation/editing support (text/code/image/sheet).
- `tests/`: Playwright E2E tests and fixtures.
- `docs/`: Setup and architecture documentation.
- `public/`: Static assets.

## Core Features
- Authenticated chat with Firebase session cookies.
- Chat history and metadata persistence in Firestore.
- Streaming model responses via AI SDK message streams.
- Provider-flexible LLM integration via LangChain (OpenAI-compatible, Anthropic, Google).
- Artifact workflows (text/code/image/sheet).
- Optional RAG context injection from stored document chunks.
- File upload endpoint with type/size validation and Firebase Storage persistence.
- UI-only local mode for frontend preview without external service dependencies.

## Development Patterns
- Guard all protected reads/writes with session checks (`auth()` + ownership checks).
- For chat/data APIs, preserve existing authorization behavior:
- Private chat data must not be returned to non-owners.
- Write operations must validate user/session and target ownership.
- Reuse existing error model (`ChatbotError`) and existing response patterns.
- Keep local UI-only mode behavior intact when touching auth/chat/upload flows.
- Use namespaced Firestore collections through `firebaseCollections`; do not hardcode collection names.

## Testing & Debugging
- Mandatory after code changes: `pnpm exec tsc --noEmit`.
- Do not run build/lint/test by default.
- Playwright is available (`pnpm test`) but should run only when explicitly requested.
- If touching auth/chat/upload flows, prioritize targeted static validation and type safety; avoid unrelated refactors.

## Environment Variables
- Keep secrets in local env files and platform secret stores. Never commit real credentials.
- Key runtime groups used by current code/docs:
- Firebase client config: `NEXT_PUBLIC_FIREBASE_*`
- Firebase admin/service account: `FIREBASE_SERVICE_ACCOUNT_*` (plus legacy fallbacks `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PROJECT_ID`)
- Firestore namespace: `NEXT_PUBLIC_DATABASE_ENV`
- LLM/provider config: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`
- Optional Redis: `REDIS_URL`
- Local UI-only flags: `LOCAL_UI_ONLY`, `NEXT_PUBLIC_UI_ONLY`
- Note: `.env.example` appears legacy compared with active Firebase docs/config; verify env source of truth in `docs/setup.md` and runtime code before changing env behavior.

## Performance
- Preserve streaming-first chat UX; avoid blocking operations inside stream execution.
- Do not remove production rate-limit safeguards (`lib/ratelimit.ts`).
- Avoid extra Firestore roundtrips in hot chat paths; reuse existing query and mapping helpers.
- Keep payload validation and ownership checks lightweight but mandatory.
- Respect optional Redis behavior: code must continue working when `REDIS_URL` is absent.
