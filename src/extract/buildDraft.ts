import type { Analysis, Equation, Parameter, Pin } from "../model/schema";
import type { PageLines } from "./pdfLines";
import {
  assignLimits,
  isOtherNumberedHeading,
  joinLabelLines,
  parseEquationLine,
  parseParamRow,
  parsePinRow,
  sectionFromHeader,
  type Section,
} from "./rows";

export interface DraftMeta {
  component: string;
  manufacturer: string;
  fileName: string;
  hash: string;
  pages: number;
}

/**
 * Construye un análisis en borrador a partir de las líneas de todas las páginas.
 * Todo lo que sale de aquí tiene reviewed = false hasta que el usuario lo confirme.
 */
export function buildDraft(pages: PageLines[], meta: DraftMeta): Analysis {
  const pins: Pin[] = [];
  const parameters: Parameter[] = [];
  const equations: Equation[] = [];
  let section: Section | null = null;

  for (const { page, lines: rawLines } of pages) {
    const lines = joinLabelLines(rawLines);
    for (const line of lines) {
      const header = sectionFromHeader(line);
      if (header) {
        section = header;
        continue;
      }
      if (isOtherNumberedHeading(line)) {
        section = "other";
        continue;
      }

      if (section === "pins") {
        const pin = parsePinRow(line);
        if (pin) {
          pins.push({ ...pin, page, reviewed: false });
          continue;
        }
      }

      // Dentro de la tabla de pines una fila de parámetros no se descarta: si no se detectó
      // el encabezado siguiente, se guarda como "otros" para revisar.
      const paramSection: Section | null = section === "pins" ? "other" : section;
      if (paramSection !== null) {
        const param = parseParamRow(line);
        if (param) {
          const limits = assignLimits(paramSection, param.values, param.symmetric);
          parameters.push({
            symbol: param.symbol,
            name: param.name,
            section: paramSection,
            min: limits.min,
            typ: limits.typ,
            max: limits.max,
            unit: param.unit,
            conditions: limits.note,
            explanation: "",
            page,
            reviewed: false,
          });
          continue;
        }
      }

      const eq = parseEquationLine(line);
      if (eq) equations.push({ ...eq, page, reviewed: false });
    }
  }

  const now = new Date().toISOString();
  return {
    id: `${meta.component}-${meta.hash.slice(0, 8)}`,
    component: meta.component,
    manufacturer: meta.manufacturer,
    datasheet: { hash: meta.hash, pages: meta.pages, fileName: meta.fileName },
    pins,
    parameters,
    equations,
    netlist: null,
    status: "draft",
    starred: false,
    createdAt: now,
    updatedAt: now,
  };
}
