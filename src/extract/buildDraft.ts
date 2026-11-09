import type { Analysis, Equation, Parameter, Pin } from "../model/schema";
import type { PageLines } from "./pdfLines";
import {
  assignLimits,
  headerColumns,
  isOtherNumberedHeading,
  joinLabelLines,
  parseEquationLine,
  parseBallRow,
  parseParamRow,
  parsePinRow,
  sectionFromHeader,
  type Columns,
  type Line,
  type Section,
} from "./rows";

export interface DraftMeta {
  component: string;
  manufacturer: string;
  fileName: string;
  hash: string;
  pages: number;
}

/** Texto que puede ser la función de un pin: no es encabezado, pie de página ni nota. */
function isPinDescriptionText(text: string): boolean {
  if (text.length < 4) return false;
  if (/^(pin\b|name\b|description\b|connection diagrams|figure\b|package number)/i.test(text)) return false;
  if (/copyright|submit document|product folder|www\.|SNOS|SLVS|SLFS|SNAS|SLOS/i.test(text)) return false;
  if (/^\(\d\)|ESD|electrostatic|static damage|limited built-in|storage or handling|MOS gates|conductive foam/i.test(text)) return false;
  return true;
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
  // Columnas Min / Typ / Max de la tabla en curso, si su encabezado se ha visto.
  let columns: Columns | null = null;
  // Pines BGA: la función puede venir en líneas antes o después del identificador.
  let lineNo = 0;
  let balls: { idx: number; lineNo: number; hasDesc: boolean }[] = [];
  let free: { text: string; lineNo: number }[] = [];
  // Partes de cada pin BGA: texto antes y después de su identificador, y su propia descripción.
  const ballParts = new Map<number, { prefix: string; own: string; pre: string[]; post: string[] }>();
  const flushBalls = () => {
    for (const f of free) {
      // Pin anterior y siguiente más cercanos (a lo sumo a dos líneas).
      const prev = [...balls].reverse().find((b) => b.lineNo < f.lineNo && f.lineNo - b.lineNo <= 2);
      const next = balls.find((b) => b.lineNo > f.lineNo && b.lineNo - f.lineNo <= 2);
      // Un pin cuya línea no trae función tiene su texto debajo: la primera línea de abajo es suya.
      const dPrev = prev ? f.lineNo - prev.lineNo : Infinity;
      const dNext = next ? next.lineNo - f.lineNo : Infinity;
      let target: { idx: number; lineNo: number } | undefined;
      if (prev && dPrev === 1 && !prev.hasDesc) target = prev;
      else if (/^[a-z(]/.test(f.text)) target = prev ?? next;
      else target = dNext <= dPrev ? next ?? prev : prev ?? next;
      if (!target) continue;
      const part = ballParts.get(target.idx);
      if (!part) continue;
      (f.lineNo < target.lineNo ? part.pre : part.post).push(f.text);
    }
    for (const b of balls) {
      const part = ballParts.get(b.idx);
      if (!part) continue;
      const text = [...part.pre, part.own, ...part.post].filter(Boolean).join(" ");
      pins[b.idx].role = [part.prefix, text].filter(Boolean).join(" · ");
    }
    balls = [];
    free = [];
  };

  for (const pg of pages) {
    const { page } = pg;
    const lines: Line[] = joinLabelLines(
      pg.lines.map((text, i) => ({ text, toks: pg.tokens[i] ?? [] })),
    );
    for (const line of lines) {
      lineNo++;
      const header = sectionFromHeader(line.text);
      if (header) {
        flushBalls();
        section = header;
        columns = null;
        continue;
      }
      if (isOtherNumberedHeading(line.text)) {
        flushBalls();
        section = "other";
        columns = null;
        continue;
      }

      const headCols = headerColumns(line.toks);
      if (headCols) {
        columns = headCols;
        continue;
      }

      if (section === "pins") {
        const ball = parseBallRow(line.text);
        if (ball) {
          pins.push({ number: 0, name: ball.name, role: [ball.ball, ball.desc].filter(Boolean).join(" · "), page, reviewed: false });
          const idx = pins.length - 1;
          balls.push({ idx, lineNo, hasDesc: ball.desc.length > 0 });
          ballParts.set(idx, { prefix: ball.ball, own: ball.desc, pre: [], post: [] });
          continue;
        }
        const pin = parsePinRow(line.text);
        if (pin) {
          pins.push({ ...pin, page, reviewed: false });
          continue;
        }
        if (isPinDescriptionText(line.text)) free.push({ text: line.text, lineNo });
        continue;
      }

      // Dentro de la tabla de pines una fila de parámetros no se descarta: si no se detectó
      // el encabezado siguiente, se guarda como "otros" para revisar.
      const paramSection: Section | null = section;
      if (paramSection !== null) {
        const param = parseParamRow(line.toks);
        if (param) {
          const limits = assignLimits(paramSection, param, columns);
          const notes = [param.conditions, limits.note].filter(Boolean).join(" · ");
          parameters.push({
            symbol: param.symbol,
            name: param.name,
            section: paramSection,
            min: limits.min,
            typ: limits.typ,
            max: limits.max,
            unit: param.unit,
            conditions: notes,
            explanation: "",
            page,
            reviewed: false,
          });
          continue;
        }
      }

      const eq = parseEquationLine(line.text);
      if (eq) equations.push({ ...eq, page, reviewed: false });
    }
  }

  flushBalls();

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
