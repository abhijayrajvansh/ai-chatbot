# Firebase Migration

The app has moved three backend services to Firebase:

| Previous variable | Previous service | Firebase replacement | Current env names |
| --- | --- | --- | --- |
| `AUTH_SECRET` | Auth.js / NextAuth | Firebase Authentication | `NEXT_PUBLIC_FIREBASE_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_*` |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob | Firebase Storage | `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `FIREBASE_SERVICE_ACCOUNT_*` |
| `POSTGRES_URL` | Postgres | Cloud Firestore | `NEXT_PUBLIC_DATABASE_ENV`, `FIREBASE_SERVICE_ACCOUNT_*` |

Still in use:

| Variable | Service | Used for |
| --- | --- | --- |
| `REDIS_URL` | Redis | Production IP rate limiting and resumable streams |

Firestore collections are namespaced by `NEXT_PUBLIC_DATABASE_ENV`. With:

```env
NEXT_PUBLIC_DATABASE_ENV=brackets
```

the app writes collections such as `brackets_users`, `brackets_chats`, `brackets_messages`, `brackets_documents`, and `brackets_suggestions`.
