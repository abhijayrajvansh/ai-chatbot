"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session } from "@/app/(auth)/auth";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

type SessionContextValue = {
  data: Session | null;
  status: SessionStatus;
  update: () => Promise<Session | null>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

async function fetchSession() {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/auth/session`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as Session | null;
}

export function FirebaseSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [data, setData] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  const update = useCallback(async () => {
    setStatus("loading");
    const nextSession = await fetchSession();
    setData(nextSession);
    setStatus(nextSession ? "authenticated" : "unauthenticated");
    return nextSession;
  }, []);

  useEffect(() => {
    update();
  }, [update]);

  const value = useMemo(
    () => ({
      data,
      status,
      update,
    }),
    [data, status, update]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within FirebaseSessionProvider");
  }
  return context;
}

export async function signOut(options?: { redirectTo?: string }) {
  await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/auth/logout`, {
    method: "POST",
  });

  if (options?.redirectTo) {
    window.location.assign(options.redirectTo);
  }
}
