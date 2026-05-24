import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  clearSessionCookie,
  FIREBASE_SESSION_COOKIE,
} from "@/lib/firebase/auth";
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

export async function auth(): Promise<Session | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(FIREBASE_SESSION_COOKIE)?.value;

  if (!sessionCookie) {
    return null;
  }

  try {
    const decoded = await firebaseAuth().verifySessionCookie(
      sessionCookie,
      false
    );
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

export async function signOut(options?: { redirectTo?: string }) {
  await clearSessionCookie();

  if (options?.redirectTo) {
    redirect(options.redirectTo);
  }
}
