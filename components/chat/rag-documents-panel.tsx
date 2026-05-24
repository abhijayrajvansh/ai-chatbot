"use client";

import { FileTextIcon, UploadIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
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

export function RagDocumentsPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data, mutate } = useSWR<{ documents: RagDocument[] }>(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/rag-documents`,
    fetcher,
    {
      refreshInterval: 4000,
    }
  );

  const documents = useMemo(() => data?.documents ?? [], [data]);
  const hasPendingDocuments = useMemo(
    () =>
      documents.some(
        (document) =>
          document.status === "queued" || document.status === "processing"
      ),
    [documents]
  );

  useEffect(() => {
    if (!hasPendingDocuments) {
      return;
    }

    const timer = setTimeout(() => {
      fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/rag-documents/process?limit=2`, {
        method: "POST",
      }).catch(() => null);
    }, 500);

    return () => clearTimeout(timer);
  }, [hasPendingDocuments]);

  const uploadFile = useCallback(
    async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/rag-documents`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "Upload failed");
      }

      await mutate();
    },
    [mutate]
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      setIsUploading(true);
      try {
        for (const file of fileArray) {
          await uploadFile(file);
        }
        toast.success("Document upload complete");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to upload document"
        );
      } finally {
        setIsUploading(false);
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
              Supports .pdf, .xls, .xlsx, .txt, .md, .csv, .json up to 50MB
            </p>
          </div>
          <input
            accept=".pdf,.xls,.xlsx,.txt,.md,.csv,.json,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/markdown,text/csv,application/json"
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
            onClick={() => {
              if (window.confirm("Delete all uploaded RAG documents?")) {
                void deleteDocuments("all");
              }
            }}
            size="sm"
            variant="outline"
          >
            Delete all
          </Button>
          <Button
            disabled={
              isDeleting || !documents.some((document) => document.status === "failed")
            }
            onClick={() => {
              if (window.confirm("Delete all failed RAG documents?")) {
                void deleteDocuments("failed");
              }
            }}
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
                      • {doc.chunkCount} chunks • {formatBytes(doc.size)} •{" "}
                      {new Date(doc.createdAt).toLocaleString()}
                    </p>
                    {doc.error ? (
                      <p className="mt-1 text-xs text-destructive">{doc.error}</p>
                    ) : null}
                  </div>
                  <Button
                    disabled={isDeleting}
                    onClick={() => {
                      if (window.confirm(`Delete "${doc.title}"?`)) {
                        void deleteDocuments("single", doc.id);
                      }
                    }}
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
    </div>
  );
}
