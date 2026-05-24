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

function getUpstashRestConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/+$/g, ""), token };
}

async function runUpstashCommand(command: string, ...args: string[]) {
  const config = getUpstashRestConfig();
  if (!config) {
    return null;
  }

  const encodedArgs = args.map((arg) => encodeURIComponent(arg));
  const endpoint = `${config.url}/${command.toLowerCase()}/${encodedArgs.join("/")}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upstash Redis error (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as {
    result?: unknown;
    error?: string;
  };

  if (payload.error) {
    throw new Error(payload.error);
  }

  return payload.result;
}

async function getRedisClient() {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl || !redisUrl.startsWith("redis://")) {
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
  const serialized = JSON.stringify(job);

  if (getUpstashRestConfig()) {
    await runUpstashCommand("RPUSH", getQueueName(), serialized);
    return true;
  }

  const client = await getRedisClient();
  if (!client) {
    return false;
  }

  await client.rPush(getQueueName(), serialized);
  return true;
}

export async function dequeueRagIngestJobs(count: number) {
  const jobs: RagIngestJob[] = [];
  const max = Math.max(1, count);

  if (getUpstashRestConfig()) {
    for (let index = 0; index < max; index += 1) {
      const raw = await runUpstashCommand("LPOP", getQueueName());
      if (typeof raw !== "string" || !raw) {
        break;
      }

      try {
        jobs.push(JSON.parse(raw) as RagIngestJob);
      } catch {
        continue;
      }
    }

    return jobs;
  }

  const client = await getRedisClient();
  if (!client) {
    return [];
  }

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
