import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { LIMITS } from "../config";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface LoadedPdf {
  doc: pdfjs.PDFDocumentProxy;
  fileName: string;
  hash: string;
  pages: number;
}

export class PdfLoadError extends Error {}

/** SHA-256 en hexadecimal, para detectar duplicados y reutilizar la caché. */
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Valida tamaño y tipo, abre el PDF y comprueba el número de páginas. */
export async function loadPdf(file: File): Promise<LoadedPdf> {
  if (file.type && file.type !== "application/pdf") {
    throw new PdfLoadError("El archivo no es un PDF.");
  }
  if (file.size > LIMITS.maxPdfBytes) {
    const maxMb = LIMITS.maxPdfBytes / (1024 * 1024);
    throw new PdfLoadError(`El PDF pesa más de ${maxMb} MB.`);
  }

  const buffer = await file.arrayBuffer();

  let doc: pdfjs.PDFDocumentProxy;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
  } catch {
    throw new PdfLoadError("No se pudo abrir el PDF. Revisa que no esté dañado o protegido con contraseña.");
  }

  if (doc.numPages > LIMITS.maxPdfPages) {
    await doc.destroy();
    throw new PdfLoadError(`El PDF tiene ${doc.numPages} páginas; el límite es ${LIMITS.maxPdfPages}.`);
  }

  return {
    doc,
    fileName: file.name,
    hash: await sha256Hex(buffer),
    pages: doc.numPages,
  };
}
