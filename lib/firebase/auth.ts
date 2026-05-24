import { cookies } from "next/headers";
import { firebaseAuth, firestore } from "./admin";
import { firebaseCollections } from "./collections";

export const FIREBASE_SESSION_COOKIE = "firebase_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 5;

type FirebaseSignInResponse = {
  idToken: string;
  localId: string;
  email?: string;
  displayName?: string;
};

function getApiKey() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is not configured");
  }
  return apiKey;
}

async function callIdentityToolkit<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${getApiKey()}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, returnSecureToken: true }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    const message =
      typeof data?.error?.message === "string"
        ? data.error.message
        : "Firebase Authentication request failed";
    throw new Error(message);
  }

  return data as T;
}

async function setSessionCookie(idToken: string) {
  const expiresIn = SESSION_MAX_AGE_SECONDS * 1000;
  const sessionCookie = await firebaseAuth().createSessionCookie(idToken, {
    expiresIn,
  });
  const cookieStore = await cookies();

  cookieStore.set(FIREBASE_SESSION_COOKIE, sessionCookie, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function signInWithEmailPassword({
  email,
  password,
}: {
  email: string;
  password: string;
}) {
  const result = await callIdentityToolkit<FirebaseSignInResponse>(
    "accounts:signInWithPassword",
    { email, password }
  );
  await firestore().collection(firebaseCollections.users).doc(result.localId).set(
    {
      id: result.localId,
      email: result.email ?? email,
      isAnonymous: false,
      updatedAt: new Date(),
    },
    { merge: true }
  );
  await setSessionCookie(result.idToken);
  return result;
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(FIREBASE_SESSION_COOKIE);
}
