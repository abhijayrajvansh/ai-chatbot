"use client";

import { onIdTokenChanged, signOut as firebaseSignOut } from "firebase/auth";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session } from "@/app/(auth)/auth";
import { firebaseClientAuth } from "@/lib/firebase/client";
import {
  FIREBASE_ID_TOKEN_COOKIE,
  FIREBASE_ID_TOKEN_MAX_AGE_SECONDS,
} from "@/lib/firebase/session";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

type SessionContextValue = {
  data: Session | null;
  status: SessionStatus;
  update: () => Promise<Session | null>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

function setIdTokenCookie(token: string) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${FIREBASE_ID_TOKEN_COOKIE}=${token}; Path=/; Max-Age=${FIREBASE_ID_TOKEN_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

function clearIdTokenCookie() {
  document.cookie = `${FIREBASE_ID_TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function FirebaseSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  const update = useCallback(async () => {
    setStatus("loading");
    const user = firebaseClientAuth().currentUser;
    if (!user) {
      clearIdTokenCookie();
      setData(null);
      setStatus("unauthenticated");
      return null;
    }

    const token = await user.getIdToken();
    setIdTokenCookie(token);
    const nextSession: Session = {
      user: {
        id: user.uid,
        email: user.email,
        name: user.displayName,
        image: user.photoURL,
        type: "regular",
      },
    };
    setData(nextSession);
    setStatus("authenticated");
    return nextSession;
  }, []);

  useEffect(() => {
    return onIdTokenChanged(firebaseClientAuth(), async (user) => {
      if (!user) {
        clearIdTokenCookie();
        setData(null);
        setStatus("unauthenticated");
        return;
      }

      const token = await user.getIdToken();
      setIdTokenCookie(token);
      setData({
        user: {
          id: user.uid,
          email: user.email,
          name: user.displayName,
          image: user.photoURL,
          type: "regular",
        },
      });
      setStatus("authenticated");
    });
  }, []);

  useEffect(() => {
    if (status === "loading") {
      return;
    }

    const isLoginPage = pathname === "/login";
    if (status === "unauthenticated" && !isLoginPage) {
      const redirectUrl = pathname && pathname !== "/" ? pathname : "";
      router.replace(
        redirectUrl
          ? `/login?redirectUrl=${encodeURIComponent(redirectUrl)}`
          : "/login"
      );
      return;
    }

    if (status === "authenticated" && isLoginPage) {
      const searchParams = new URLSearchParams(window.location.search);
      const redirectUrl = searchParams.get("redirectUrl") || "/";
      router.replace(redirectUrl.startsWith("/") ? redirectUrl : "/");
    }
  }, [pathname, router, status]);

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
  await firebaseSignOut(firebaseClientAuth());
  clearIdTokenCookie();

  if (options?.redirectTo) {
    window.location.assign(options.redirectTo);
  }
}
