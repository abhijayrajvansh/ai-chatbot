"use client";

import { FileTextIcon, UploadIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
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
  chunkCount: number;
  createdAt: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RagDocumentsPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const { data, mutate } = useSWR<{ documents: RagDocument[] }>(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/rag-documents`,
    fetcher
  );

  const documents = useMemo(() => data?.documents ?? [], [data]);

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
      } finally {
        setIsUploading(false);
      }
    },
    [uploadFile]
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
              Supports .pdf, .xls, .xlsx, .txt, .md, .csv, .json up to 5MB
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
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
            size="sm"
            variant="outline"
          >
            {isUploading ? "Uploading..." : "Upload files"}
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
                      {doc.chunkCount} chunks • {formatBytes(doc.size)} • {new Date(doc.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
