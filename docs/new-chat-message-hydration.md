# New Chat Message Hydration Guard

This note documents a recurring bug in the new-chat flow and the guard that must be preserved.

## Symptom

- User sends the first query from the empty chat screen.
- The app changes the URL to `/chat/{id}`.
- The page briefly renders as a blank chat.
- The assistant response starts streaming, but the original user query is missing.
- The user query may only appear after manual refreshes once the server history catches up.

## Root Cause

- New chats optimistically add the user message on the client with `useChat`.
- The URL is changed to `/chat/{id}` before or while the request is in flight.
- `ActiveChatProvider` then hydrates messages for the routed chat by fetching `/api/messages?chatId={id}`.
- That fetch can return empty or stale history before the just-submitted user message has been persisted.
- If hydration blindly calls `setMessages(serverMessages)`, it overwrites the optimistic local user message.

## Current Fix

Implemented in `hooks/use-active-chat.tsx`.

- Keep refs for the latest local `messages` and chat `status`.
- During non-new-chat hydration, compare server messages against current local messages.
- Do not replace local messages when the local conversation has more messages than the server response.
- Do not replace local messages while a local generation is active (`submitted` or `streaming`) and local messages exist.
- Only hydrate from server when it will not erase a more complete in-flight local state.

## Guardrail For Future Changes

- Do not blindly call `setMessages(payload.messages ?? [])` after route changes.
- Treat `/api/messages` hydration as eventually consistent during first-message submission.
- Preserve optimistic messages while `useChat` is `submitted` or `streaming`.
- New-chat navigation, sidebar/history refresh, and message hydration must not clear the first user message.

## Relevant Files

- `hooks/use-active-chat.tsx`: chat id derivation, `useChat`, message hydration, auto-resume.
- `components/chat/multimodal-input.tsx`: first-message submission and URL push to `/chat/{id}`.
- `app/(chat)/api/chat/route.ts`: server-side chat/message persistence and streaming response.
- `app/(chat)/api/messages/route.ts`: message history hydration endpoint.
