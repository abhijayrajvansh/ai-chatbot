import { cookies, headers } from "next/headers";
import { FIREBASE_ID_TOKEN_COOKIE } from "@/lib/firebase/session";
import { firebaseAuth, firestore } from "@/lib/firebase/admin";
import { firebaseCollections } from "@/lib/firebase/collections";

export type UserType = "regular";

export type AuthUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  type: UserType;
};

export type Session = {
  user: AuthUser;
};

async function getFirebaseIdToken() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const cookieToken = cookieStore.get(FIREBASE_ID_TOKEN_COOKIE)?.value;
  if (cookieToken) {
    return cookieToken;
  }

  const authorization = headerStore.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}

export async function auth(): Promise<Session | null> {
  const idToken = await getFirebaseIdToken();

  if (!idToken) {
    return null;
  }

  try {
    const decoded = await firebaseAuth().verifyIdToken(idToken, false);
    const userRecord = await firebaseAuth().getUser(decoded.uid);
    const userDoc = await firestore()
      .collection(firebaseCollections.users)
      .doc(decoded.uid)
      .get();
    const storedUser = userDoc.data();
    const email = userRecord.email ?? storedUser?.email ?? null;

    return {
      user: {
        id: decoded.uid,
        email,
        name: userRecord.displayName ?? storedUser?.name ?? null,
        image: userRecord.photoURL ?? storedUser?.image ?? null,
        type: "regular",
      },
    };
  } catch {
    return null;
  }
}
