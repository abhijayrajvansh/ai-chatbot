import { createClient } from "redis";

export type RagIngestJob = {
  jobId: string;
  ragDocumentId: string;
  userId: string;
  documentId: string;
  storagePath: string;
  mimeType: string;
  checksum: string;
  enqueuedAt: string;
};

type QueueRedisClient = ReturnType<typeof createClient>;

let clientPromise: Promise<QueueRedisClient> | null = null;

function getQueueName() {
  return process.env.RAG_QUEUE_NAME?.trim() || "rag-index-jobs";
}

async function getRedisClient() {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    return null;
  }

  if (!clientPromise) {
    const client = createClient({ url: redisUrl });
    client.on("error", (error) => {
      console.error("RAG queue Redis error", error);
    });
    clientPromise = client.connect().then(() => client);
  }

  return clientPromise;
}

export async function enqueueRagIngestJob(job: RagIngestJob) {
  const client = await getRedisClient();
  if (!client) {
    return false;
  }

  await client.rPush(getQueueName(), JSON.stringify(job));
  return true;
}

export async function dequeueRagIngestJobs(count: number) {
  const client = await getRedisClient();
  if (!client) {
    return [];
  }

  const jobs: RagIngestJob[] = [];
  const max = Math.max(1, count);

  for (let index = 0; index < max; index += 1) {
    const raw = await client.lPop(getQueueName());
    if (!raw) {
      break;
    }

    try {
      const parsed = JSON.parse(raw) as RagIngestJob;
      jobs.push(parsed);
    } catch {
      continue;
    }
  }

  return jobs;
}
