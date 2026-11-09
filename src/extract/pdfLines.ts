import type { PDFDocumentProxy } from "pdfjs-dist";

export interface PageLines {
  page: number;
  lines: string[];
}

interface RawItem {
  str?: string;
  transform?: number[];
}

/**
 * Reconstruye las líneas de una página a partir del texto con posición de pdf.js.
 * Agrupa los fragmentos por coordenada vertical y los ordena de arriba a abajo.
 */
export async function extractPageLines(doc: PDFDocumentProxy, pageNumber: number): Promise<string[]> {
  const page = await doc.getPage(pageNumber);
  try {
    const content = await page.getTextContent();
    const items = (content.items as unknown as RawItem[]).filter(
      (it): it is { str: string; transform: number[] } =>
        typeof it.str === "string" && it.str.trim() !== "" && Array.isArray(it.transform),
    );

    const rows: { y: number; items: { str: string; x: number }[] }[] = [];
    for (const it of items) {
      const y = it.transform[5];
      const x = it.transform[4];
      const row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (row) row.items.push({ str: it.str, x });
      else rows.push({ y, items: [{ str: it.str, x }] });
    }

    rows.sort((a, b) => b.y - a.y);
    return rows
      .map((r) =>
        r.items
          .sort((a, b) => a.x - b.x)
          .map((i) => i.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter((l) => l.length > 0);
  } finally {
    page.cleanup();
  }
}
