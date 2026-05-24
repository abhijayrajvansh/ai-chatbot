const DATABASE_ENV = process.env.NEXT_PUBLIC_DATABASE_ENV?.trim();

export function collectionName(name: string) {
  return DATABASE_ENV ? `${DATABASE_ENV}_${name}` : name;
}

export const firebaseCollections = {
  users: collectionName("users"),
  chats: collectionName("chats"),
  messages: collectionName("messages"),
  votes: collectionName("votes"),
  documents: collectionName("documents"),
  documentChunks: collectionName("document_chunks"),
  suggestions: collectionName("suggestions"),
  streams: collectionName("streams"),
};
