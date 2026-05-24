import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

function getPrivateKey() {
  return (
    process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY ??
    process.env.FIREBASE_PRIVATE_KEY
  )?.replace(/\\n/g, "\n");
}

function getProjectId() {
  return (
    process.env.FIREBASE_SERVICE_ACCOUNT_PROJECT_ID ??
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  );
}

function getClientEmail() {
  return (
    process.env.FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL ??
    process.env.FIREBASE_CLIENT_EMAIL
  );
}

function getStorageBucket() {
  return (
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    process.env.FIREBASE_STORAGE_BUCKET
  );
}

function getFirestoreDatabaseId() {
  const databaseEnv = process.env.NEXT_PUBLIC_DATABASE_ENV?.trim();

  if (!databaseEnv) {
    return undefined;
  }

  return databaseEnv === "default" ? "(default)" : databaseEnv;
}

function initializeFirebaseAdminApp(): App {
  const existingApp = getApps()[0];
  if (existingApp) {
    return existingApp;
  }

  const projectId = getProjectId();
  const clientEmail = getClientEmail();
  const privateKey = getPrivateKey();
  const storageBucket = getStorageBucket();

  if (clientEmail && privateKey && projectId) {
    return initializeApp({
      credential: cert({ clientEmail, privateKey, projectId }),
      projectId,
      storageBucket,
    });
  }

  return initializeApp({
    projectId,
    storageBucket,
  });
}

export function firebaseAdminApp() {
  return initializeFirebaseAdminApp();
}

export function firebaseAuth() {
  return getAuth(firebaseAdminApp());
}

export function firestore() {
  const databaseId = getFirestoreDatabaseId();
  return databaseId
    ? getFirestore(firebaseAdminApp(), databaseId)
    : getFirestore(firebaseAdminApp());
}

export function firebaseStorageBucket() {
  return getStorage(firebaseAdminApp()).bucket();
}
