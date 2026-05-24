import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { isLocalUiOnlyMode } from "@/lib/local-mode";
import { dequeueRagIngestJobs, enqueueRagIngestJob } from "@/lib/rag/queue";
import { processRagIngestJob } from "@/lib/rag/worker";

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function canUseWorkerSecret(request: Request) {
  const expectedSecret = process.env.RAG_WORKER_SECRET?.trim();
  if (!expectedSecret) {
    return false;
  }
  const actualSecret = request.headers.get("x-rag-worker-secret")?.trim();
  return actualSecret === expectedSecret;
}

export async function POST(request: Request) {
  if (isLocalUiOnlyMode) {
    return NextResponse.json({ processed: 0, skipped: "local_ui_only" });
  }

  const session = await auth();
  const hasWorkerSecret = canUseWorkerSecret(request);

  if (!session?.user && !hasWorkerSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = parsePositiveInt(searchParams.get("limit"), 2);
  const jobs = await dequeueRagIngestJobs(limit);

  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    if (session?.user && !hasWorkerSecret && job.userId !== session.user.id) {
      await enqueueRagIngestJob(job);
      continue;
    }

    const result = await processRagIngestJob(job);

    if (result.reason === "retryable_failure") {
      await enqueueRagIngestJob(job);
      continue;
    }

    if (result.status === "failed") {
      failed += 1;
    }

    if (result.processed) {
      processed += 1;
    }
  }

  return NextResponse.json({
    dequeued: jobs.length,
    processed,
    failed,
  });
}
