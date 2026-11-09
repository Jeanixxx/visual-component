/**
 * OCR local para PDFs escaneados (sin texto seleccionable).
 *
 * Corre en el navegador con tesseract.js. El motor y los datos de idioma salen del propio sitio
 * (public/ocr, copiados por scripts/copy-ocr-assets.mjs): no se descarga nada de un CDN.
 * Cada página se vuelve líneas con la posición de sus palabras, igual que el texto nativo del PDF.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PageLines, Token } from "../extract/pdfLines";

/** Máximo de páginas que se leen con OCR: es lento (varios segundos por página). */
export const OCR_MAX_PAGES = 40;

/** Ancho objetivo de la imagen que se reconoce, en píxeles: más resolución, mejor lectura. */
const TARGET_WIDTH = 2550; // ~300 dpi en una hoja carta: suficiente para tablas de letra pequeña

/** Menos de este promedio de caracteres por página se considera un PDF sin texto. */
const MIN_CHARS_PER_PAGE = 40;

export function looksScanned(pages: PageLines[]): boolean {
  if (pages.length === 0) return false;
  const chars = pages.reduce((n, p) => n + p.lines.join("").length, 0);
  return chars / pages.length < MIN_CHARS_PER_PAGE;
}

function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return new URL(`${base}ocr/${path}`, window.location.href).href;
}

async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<{ canvas: HTMLCanvasElement; dpi: number }> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = TARGET_WIDTH / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar la imagen de la página.");
  await page.render({ canvasContext: context, viewport }).promise;
  page.cleanup();
  // Resolución real de la imagen (la página mide base.width / 72 pulgadas). Tesseract la estima mal
  // en imágenes sin metadatos y lee muy mal la letra pequeña; indicarla explícitamente lo arregla.
  const dpi = Math.round(canvas.width / (base.width / 72));
  return { canvas, dpi };
}

/** Falla con un mensaje claro si una operación tarda demasiado, en vez de dejar la app colgada. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

interface OcrWord {
  s: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Quita los bordes de tabla que el OCR lee como texto ("|", "[", "]") y los extremos sueltos. */
function cleanWord(text: string): string {
  const t = text.trim();
  if (/^[|\[\]{}_]+$/.test(t)) return "";
  return t.replace(/^[|\[({]+/, "").replace(/[|\])}]+$/, "");
}

/**
 * Reagrupa las palabras en filas por su altura. Tesseract separa las celdas de una tabla en
 * líneas distintas; aquí se vuelven a juntar para que cada fila de la tabla sea una línea,
 * como en el texto nativo de un PDF.
 */
function groupRows(words: OcrWord[]): Token[][] {
  if (words.length === 0) return [];
  const heights = words.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const h = heights[Math.floor(heights.length / 2)] || 20;
  const sorted = [...words].sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1));
  const rows: { yc: number; ws: OcrWord[] }[] = [];
  for (const w of sorted) {
    const yc = (w.y0 + w.y1) / 2;
    const last = rows[rows.length - 1];
    if (last && Math.abs(yc - last.yc) < 0.6 * h) {
      last.ws.push(w);
      last.yc = (last.yc * (last.ws.length - 1) + yc) / last.ws.length;
    } else {
      rows.push({ yc, ws: [w] });
    }
  }
  return rows.map((r) =>
    r.ws.sort((a, b) => a.x0 - b.x0).map((w) => ({ s: w.s, xc: (w.x0 + w.x1) / 2 })),
  );
}

export interface OcrProgress {
  page: number;
  total: number;
}

/**
 * Lee con OCR las páginas del PDF. Devuelve el mismo formato que la extracción de texto nativo.
 * `onProgress` se llama antes de cada página. `truncated` indica si se recortó por el límite de páginas.
 */
export async function ocrPdf(
  doc: PDFDocumentProxy,
  onProgress?: (p: OcrProgress) => void,
): Promise<{ pages: PageLines[]; truncated: boolean }> {
  const { createWorker, PSM } = await import("tesseract.js");
  let rejectStartup: (e: Error) => void = () => {};
  const startupFailed = new Promise<never>((_, reject) => {
    rejectStartup = reject;
  });
  const worker = await withTimeout(
    Promise.race([
      createWorker("eng", 1, {
        workerPath: assetUrl("worker.min.js"),
        corePath: assetUrl("core"),
        langPath: assetUrl("lang"),
        gzip: true,
        workerBlobURL: false,
        errorHandler: () => rejectStartup(new Error("El motor de OCR no pudo cargar sus archivos.")),
      }),
      startupFailed,
    ]),
    90_000,
    "El motor de OCR no arrancó a tiempo.",
  );

  // Una columna de texto de tamaños variables: es el modo que mejor lee las tablas de los datasheets.
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN, preserve_interword_spaces: "1" });

  const total = Math.min(doc.numPages, OCR_MAX_PAGES);
  const pages: PageLines[] = [];
  try {
    for (let p = 1; p <= total; p++) {
      onProgress?.({ page: p, total });
      const { canvas, dpi } = await renderPageToCanvas(doc, p);
      await worker.setParameters({ user_defined_dpi: String(dpi) });
      const { data } = await withTimeout(
        worker.recognize(canvas, {}, { blocks: true }),
        180_000,
        `El OCR tardó demasiado en la página ${p}.`,
      );

      const words: OcrWord[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            for (const w of line.words) {
              const s = cleanWord(w.text);
              if (s !== "") words.push({ s, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 });
            }
          }
        }
      }
      const rows = groupRows(words);
      pages.push({ page: p, lines: rows.map((r) => r.map((t) => t.s).join(" ")), tokens: rows });
    }
  } finally {
    await worker.terminate();
  }
  return { pages, truncated: doc.numPages > OCR_MAX_PAGES };
}
