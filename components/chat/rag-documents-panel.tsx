"use client";

import { FileTextIcon, UploadIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, fetcher } from "@/lib/utils";

type RagDocument = {
  id: string;
  documentId: string;
  title: string;
  fileName: string;
  mimeType: string;
  size: number;
  checksum: string;
  status: "queued" | "processing" | "ready" | "failed";
  error: string | null;
  embeddingModel: string;
  chunkCount: number;
  ragProvider: "legacy-custom" | "pinecone-assistant";
  pineconeAssistantFileStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusDotClass(status: RagDocument["status"]) {
  if (status === "ready") {
    return "bg-emerald-500";
  }
  if (status === "processing") {
    return "bg-amber-400";
  }
  return "bg-muted-foreground/40";
}

function getDocumentMeta(doc: RagDocument) {
  const provider =
    doc.ragProvider === "pinecone-assistant"
      ? "Pinecone Assistant"
      : `${doc.chunkCount} chunks`;

  return `${provider} • ${formatBytes(doc.size)} • ${new Date(doc.createdAt).toLocaleString()}`;
}

export function RagDocumentsPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadLoadedBytes, setUploadLoadedBytes] = useState(0);
  const [uploadTotalBytes, setUploadTotalBytes] = useState(0);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadStartedAt, setUploadStartedAt] = useState<number | null>(null);
  const [uploadElapsedSeconds, setUploadElapsedSeconds] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<{
    mode: "single" | "failed" | "all";
    id?: string;
    title?: string;
  } | null>(null);

  const { data, mutate } = useSWR<{ documents: RagDocument[] }>(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/rag-documents`,
    fetcher,
    {
      refreshInterval: 4000,
    }
  );

  const documents = useMemo(() => data?.documents ?? [], [data]);
  useEffect(() => {
    if (!showUploadDialog || uploadStartedAt === null) {
      return;
    }

    setUploadElapsedSeconds(Math.max(0, Math.floor((Date.now() - uploadStartedAt) / 1000)));
    const timer = setInterval(() => {
      setUploadElapsedSeconds(Math.max(0, Math.floor((Date.now() - uploadStartedAt) / 1000)));
    }, 1000);

    return () => clearInterval(timer);
  }, [showUploadDialog, uploadStartedAt]);

  const uploadFile = useCallback(
    async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(
          "POST",
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/rag-documents`
        );

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) {
            return;
          }

          const nextLoaded = event.loaded;
          const nextTotal = event.total;
          const nextPercent = Math.min(100, Math.round((nextLoaded / nextTotal) * 100));

          setUploadLoadedBytes(nextLoaded);
          setUploadTotalBytes(nextTotal);
          setUploadPercent(nextPercent);
        };

        xhr.onerror = () => {
          reject(new Error("Upload failed"));
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
            return;
          }

          try {
            const payload = JSON.parse(xhr.responseText) as { error?: string };
            reject(new Error(payload.error ?? "Upload failed"));
          } catch {
            reject(new Error("Upload failed"));
          }
        };

        xhr.send(formData);
      });

      setUploadPercent(100);
      setUploadLoadedBytes(file.size);
      setUploadTotalBytes(file.size);
      await mutate();
    },
    [mutate]
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      setIsUploading(true);
      setShowUploadDialog(true);
      setUploadStartedAt(Date.now());
      setUploadElapsedSeconds(0);
      try {
        for (const file of fileArray) {
          setUploadFileName(file.name);
          setUploadLoadedBytes(0);
          setUploadTotalBytes(file.size);
          setUploadPercent(0);
          await uploadFile(file);
        }
        toast.success("Document upload complete");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to upload document"
        );
      } finally {
        setIsUploading(false);
        setShowUploadDialog(false);
        setUploadFileName("");
        setUploadLoadedBytes(0);
        setUploadTotalBytes(0);
        setUploadPercent(0);
        setUploadStartedAt(null);
        setUploadElapsedSeconds(0);
      }
    },
    [uploadFile]
  );

  const deleteDocuments = useCallback(
    async (mode: "single" | "failed" | "all", id?: string) => {
      setIsDeleting(true);
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/rag-documents`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode, id }),
          }
        );

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error ?? "Delete failed");
        }

        await mutate();
        toast.success("Document(s) deleted");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to delete");
      } finally {
        setIsDeleting(false);
      }
    },
    [mutate]
  );

  const openDeleteDialog = useCallback(
    (mode: "single" | "failed" | "all", id?: string, title?: string) => {
      setPendingDelete({ mode, id, title });
      setShowDeleteDialog(true);
    },
    []
  );

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) {
      return;
    }

    setShowDeleteDialog(false);
    await deleteDocuments(pendingDelete.mode, pendingDelete.id);
    setPendingDelete(null);
  }, [deleteDocuments, pendingDelete]);

  return (
    <div className="absolute inset-0 z-30 bg-background">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-8">
        <div>
          <h1 className="text-2xl font-semibold">RAG Documents</h1>
          <p className="text-sm text-muted-foreground">
            Upload text documents for retrieval-augmented chat.
          </p>
        </div>

        <button
          className={cn(
            "flex min-h-44 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed transition-colors",
            isDragging
              ? "border-foreground bg-accent"
              : "border-border bg-card/40 hover:bg-card"
          )}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setIsDragging(false);
          }}
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={async (event) => {
            event.preventDefault();
            setIsDragging(false);
            await handleFiles(event.dataTransfer.files);
          }}
          type="button"
        >
          <UploadIcon className="size-6 text-muted-foreground" />
          <div className="text-center">
            <p className="text-sm font-medium">
              Drag and drop files here, or click to upload
            </p>
            <p className="text-xs text-muted-foreground">
              Supports .pdf, .docx, .txt, .md, .json up to 50MB
            </p>
          </div>
          <input
            accept=".pdf,.docx,.txt,.md,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,application/json"
            className="hidden"
            multiple
            onChange={async (event) => {
              if (event.target.files) {
                await handleFiles(event.target.files);
              }
              event.currentTarget.value = "";
            }}
            ref={inputRef}
            type="file"
          />
        </button>

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Uploaded documents ({documents.length})
          </h2>
          <Button
            disabled={isUploading || isDeleting}
            onClick={() => inputRef.current?.click()}
            size="sm"
            variant="outline"
          >
            {isUploading ? "Uploading..." : "Upload files"}
          </Button>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            disabled={isDeleting || documents.length === 0}
            onClick={() => openDeleteDialog("all")}
            size="sm"
            variant="outline"
          >
            Delete all
          </Button>
          <Button
            disabled={
              isDeleting || !documents.some((document) => document.status === "failed")
            }
            onClick={() => openDeleteDialog("failed")}
            size="sm"
            variant="outline"
          >
            Delete failed
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border">
          {documents.length === 0 ? (
            <div className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
              No RAG documents uploaded yet.
            </div>
          ) : (
            <div className="divide-y">
              {documents.map((doc) => (
                <div className="flex items-center justify-between p-4" key={doc.id}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                      <p className="truncate text-sm font-medium">{doc.title}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "inline-block size-1.5 rounded-full",
                            statusDotClass(doc.status)
                          )}
                        />
                        {doc.status}
                      </span>{" "}
                      • {getDocumentMeta(doc)}
                    </p>
                    {doc.error ? (
                      <p className="mt-1 text-xs text-destructive">{doc.error}</p>
                    ) : null}
                  </div>
                  <Button
                    disabled={isDeleting}
                    onClick={() => openDeleteDialog("single", doc.id, doc.title)}
                    size="sm"
                    variant="outline"
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <AlertDialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.mode === "single"
                ? `This will permanently delete "${pendingDelete.title ?? "this document"}" and its indexed data.`
                : pendingDelete?.mode === "failed"
                  ? "This will permanently delete all failed uploaded documents and their indexed data."
                  : "This will permanently delete all uploaded documents and their indexed data."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setPendingDelete(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        onOpenChange={(open) => {
          if (!isUploading && !open) {
            setShowUploadDialog(false);
          }
        }}
        open={showUploadDialog}
      >
        <DialogContent
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>Uploading document...</DialogTitle>
            <DialogDescription>
              Keep this window open while your file uploads and is submitted.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <p className="truncate text-sm font-medium">{uploadFileName}</p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-foreground transition-all duration-150"
                style={{ width: `${uploadPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {formatBytes(uploadLoadedBytes)} / {formatBytes(uploadTotalBytes)}
              </span>
              <span>{uploadPercent}%</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Loading time: {uploadElapsedSeconds}s
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
