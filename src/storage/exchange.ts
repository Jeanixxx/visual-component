/**
 * Exportar e importar análisis en JSON, para respaldarlos o moverlos a otro dispositivo.
 */
import type { Analysis } from "../model/schema";

export const EXCHANGE_FORMAT = "amper-analyses";
export const EXCHANGE_VERSION = 1;

interface ExchangeFile {
  format: typeof EXCHANGE_FORMAT;
  version: typeof EXCHANGE_VERSION;
  exportedAt: string;
  analyses: Analysis[];
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Comprobación de forma: evita importar datos que no son análisis de Amper. */
export function isAnalysis(x: unknown): x is Analysis {
  if (!isObj(x)) return false;
  if (typeof x.id !== "string" || x.id === "") return false;
  if (typeof x.component !== "string" || typeof x.manufacturer !== "string") return false;
  if (!isObj(x.datasheet) || typeof x.datasheet.hash !== "string") return false;
  if (!Array.isArray(x.pins) || !Array.isArray(x.parameters) || !Array.isArray(x.equations)) return false;
  if (x.status !== "draft" && x.status !== "reviewed") return false;
  return true;
}

export function buildExport(analyses: Analysis[]): Blob {
  const file: ExchangeFile = {
    format: EXCHANGE_FORMAT,
    version: EXCHANGE_VERSION,
    exportedAt: new Date().toISOString(),
    analyses,
  };
  return new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
}

/** Lee un archivo exportado. Lanza error si el formato no es válido. */
export function parseImport(text: string): Analysis[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("El archivo no es JSON válido.");
  }
  if (!isObj(data) || data.format !== EXCHANGE_FORMAT) {
    throw new Error("El archivo no es una exportación de Amper.");
  }
  if (data.version !== EXCHANGE_VERSION || !Array.isArray(data.analyses)) {
    throw new Error("La versión de la exportación no es compatible.");
  }
  const valid = data.analyses.filter(isAnalysis);
  if (valid.length === 0) throw new Error("La exportación no contiene análisis válidos.");
  return valid.map((a) => ({ ...a, starred: true }));
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
