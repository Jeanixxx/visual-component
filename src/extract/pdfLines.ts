import type { PDFDocumentProxy } from "pdfjs-dist";

/** Palabra de una línea con su posición horizontal (centro, en puntos del PDF). */
export interface Token {
  s: string;
  xc: number;
}

export interface PageLines {
  page: number;
  /** Texto de cada línea, de arriba a abajo. */
  lines: string[];
  /** Palabras de cada línea con su posición, para asignar valores a columnas. */
  tokens: Token[][];
}

interface RawItem {
  str?: string;
  transform?: number[];
  width?: number;
}

/**
 * Reconstruye las líneas de una página a partir del texto con posición de pdf.js.
 * Agrupa los fragmentos por coordenada vertical y los ordena de arriba a abajo.
 */
export async function extractPageLines(doc: PDFDocumentProxy, pageNumber: number): Promise<PageLines> {
  const page = await doc.getPage(pageNumber);
  try {
    const content = await page.getTextContent();
    const items = (content.items as unknown as RawItem[]).filter(
      (it): it is { str: string; transform: number[]; width?: number } =>
        typeof it.str === "string" && it.str.trim() !== "" && Array.isArray(it.transform),
    );

    type Frag = { str: string; x: number; w: number };
    const rows: { y: number; frags: Frag[] }[] = [];
    for (const it of items) {
      const y = it.transform[5];
      const x = it.transform[4];
      const w = it.width ?? 0;
      const row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (row) row.frags.push({ str: it.str, x, w });
      else rows.push({ y, frags: [{ str: it.str, x, w }] });
    }

    rows.sort((a, b) => b.y - a.y);
    const lines: string[] = [];
    const tokens: Token[][] = [];
    for (const r of rows) {
      r.frags.sort((a, b) => a.x - b.x);
      const toks: Token[] = [];
      for (const f of r.frags) {
        const words = f.str.split(/\s+/).filter(Boolean);
        // Una palabra por trozo: si el trozo tiene varias, se reparte su ancho entre ellas.
        words.forEach((word, k) => {
          const share = f.w / Math.max(1, words.length);
          toks.push({ s: word, xc: f.x + share * k + share / 2 });
        });
      }
      const text = toks.map((t) => t.s).join(" ").replace(/\s+/g, " ").trim();
      if (text.length === 0) continue;
      lines.push(text);
      tokens.push(toks);
    }
    return { page: pageNumber, lines, tokens };
  } finally {
    page.cleanup();
  }
}
