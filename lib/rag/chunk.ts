export type TextChunk = {
  chunkIndex: number;
  content: string;
};

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function chunkText(
  text: string,
  {
    chunkSize = parsePositiveInt(process.env.RAG_CHUNK_SIZE, 1200),
    overlap = parsePositiveInt(process.env.RAG_CHUNK_OVERLAP, 180),
  }: { chunkSize?: number; overlap?: number } = {}
) {
  const normalized = text.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n{2,}/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks: TextChunk[] = [];
  let current = "";
  let chunkIndex = 0;

  const flush = () => {
    const content = current.trim();
    if (content) {
      chunks.push({ chunkIndex, content });
      chunkIndex += 1;
    }
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }

    if ((current + "\n\n" + paragraph).length <= chunkSize) {
      current = `${current}\n\n${paragraph}`;
      continue;
    }

    flush();

    if (paragraph.length <= chunkSize) {
      current = paragraph;
      continue;
    }

    for (let i = 0; i < paragraph.length; i += chunkSize - overlap) {
      const slice = paragraph.slice(i, i + chunkSize).trim();
      if (slice) {
        chunks.push({ chunkIndex: chunkIndex++, content: slice });
      }
    }
  }

  flush();
  return chunks;
}
