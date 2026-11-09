import type { Analysis, Equation, Parameter, Pin } from "../model/schema";
import type { PageLines } from "./pdfLines";
import {
  assignLimits,
  headerColumns,
  isConditionLine,
  isOtherNumberedHeading,
  joinLabelLines,
  looksLikeSpecLine,
  parseBallRow,
  parseEquationLine,
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
  /** true si el texto salió de OCR: cada parámetro queda con una nota para verificarlo. */
  ocr?: boolean;
}

/** Qué pasó durante el análisis, para explicarle al usuario por qué salió lo que salió. */
export interface DraftReport {
  pages: number;
  /** Caracteres de texto leídos en todo el PDF. */
  textChars: number;
  ocr: boolean;
  /**
   * "estricto": se usaron los encabezados de sección reconocidos.
   * "flexible": no se encontraron suficientes datos con encabezados, así que se leyó todo sin depender de ellos.
   */
  mode: "estricto" | "flexible";
  /** Cuántos encabezados de cada sección se reconocieron. */
  sections: Record<string, number>;
  /** Encabezados de tabla con columnas Min / Typ / Max. */
  tableHeaders: number;
  /** Líneas que parecen filas de especificación (un número con su unidad). */
  specLines: number;
  /** Ejemplos de esas líneas que no se pudieron interpretar. */
  unmatched: string[];
  /** Los pines salieron de una lista numerada, no de una tabla con encabezado. */
  pinsFromRun: boolean;
  hints: string[];
}

interface Pass {
  pins: Pin[];
  parameters: Parameter[];
  equations: Equation[];
  sections: Record<string, number>;
  tableHeaders: number;
  specLines: number;
  unmatched: string[];
}

/** Texto que puede ser la función de un pin: no es encabezado, pie de página ni nota. */
function isPinDescriptionText(text: string): boolean {
  if (text.length < 4) return false;
  if (/^(pin\b|name\b|description\b|connection diagrams|figure\b|package number)/i.test(text)) return false;
  if (/copyright|submit document|product folder|www\.|SNOS|SLVS|SLFS|SNAS|SLOS/i.test(text)) return false;
  if (/^\(\d\)|ESD|electrostatic|static damage|limited built-in|storage or handling|MOS gates|conductive foam/i.test(text)) return false;
  return true;
}

/** Un pin aparece en la tabla y en el dibujo del encapsulado: se conserva la fila con más información. */
function dedupePins(pins: Pin[]): Pin[] {
  const best = new Map<string, Pin>();
  for (const p of pins) {
    const key = `${p.name.toUpperCase()}|${p.number}`;
    const cur = best.get(key);
    if (!cur || p.role.length > cur.role.length) best.set(key, p);
  }
  return pins.filter((p) => best.get(`${p.name.toUpperCase()}|${p.number}`) === p);
}

/**
 * Una pasada sobre todas las páginas.
 * En modo `loose` no se exige un encabezado de sección reconocido antes de leer filas:
 * lo que aparece antes del primer encabezado se guarda en "otros".
 */
function runPass(pages: PageLines[], meta: DraftMeta, loose: boolean): Pass {
  const pins: Pin[] = [];
  const parameters: Parameter[] = [];
  const equations: Equation[] = [];
  const sections: Record<string, number> = {};
  const unmatched: string[] = [];
  let tableHeaders = 0;
  let specLines = 0;
  let section: Section | null = loose ? "other" : null;
  // Columnas Min / Typ / Max de la tabla en curso, si su encabezado se ha visto.
  let columns: Columns | null = null;
  // Pines BGA: la función puede venir en líneas antes o después del identificador.
  let lineNo = 0;
  let balls: { idx: number; lineNo: number; hasDesc: boolean }[] = [];
  let free: { text: string; lineNo: number }[] = [];
  // Filas de parámetros y líneas de condición cercanas, para unirlas al cerrar cada sección.
  let paramRefs: { idx: number; lineNo: number }[] = [];
  let condLines: { text: string; lineNo: number }[] = [];
  let lastParam: { idx: number; lineNo: number } | null = null;
  const flushParams = () => {
    for (const c of condLines) {
      const prev = [...paramRefs].reverse().find((p) => p.lineNo < c.lineNo && c.lineNo - p.lineNo <= 2);
      const next = paramRefs.find((p) => p.lineNo > c.lineNo && p.lineNo - c.lineNo <= 2);
      const dPrev = prev ? c.lineNo - prev.lineNo : Infinity;
      const dNext = next ? next.lineNo - c.lineNo : Infinity;
      const target = dPrev <= dNext ? prev ?? next : next ?? prev;
      if (!target) continue;
      const p = parameters[target.idx];
      p.conditions = [p.conditions, c.text].filter(Boolean).join(" · ");
    }
    paramRefs = [];
    condLines = [];
    lastParam = null;
  };

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
        flushParams();
        section = header;
        sections[header] = (sections[header] ?? 0) + 1;
        columns = null;
        continue;
      }
      if (isOtherNumberedHeading(line.text)) {
        flushBalls();
        flushParams();
        section = "other";
        columns = null;
        continue;
      }

      const headCols = headerColumns(line.toks);
      if (headCols) {
        columns = headCols;
        tableHeaders++;
        continue;
      }

      const isSpec = looksLikeSpecLine(line.text);
      if (isSpec) specLines++;

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

      const paramSection: Section | null = section;
      if (paramSection !== null) {
        if (/^\(\d+\)$/.test(line.text)) continue;
        if (isConditionLine(line.text)) {
          condLines.push({ text: line.text, lineNo });
          continue;
        }
        const param = parseParamRow(line.toks);
        if (param) {
          const limits = assignLimits(paramSection, param, columns);
          const notes = [
            param.conditions,
            limits.note,
            loose && Object.keys(sections).length === 0 ? "sin encabezado de sección: clasificar" : "",
            meta.ocr ? "OCR: verificar contra la página" : "",
          ]
            .filter(Boolean)
            .join(" · ");
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
          const ref = { idx: parameters.length - 1, lineNo };
          paramRefs.push(ref);
          lastParam = ref;
          continue;
        }
        // Final del nombre de la fila anterior que se partió en dos líneas: "minimum setting", "limit".
        if (lastParam && lineNo === lastParam.lineNo + 1 && /^[a-z][a-z ,-]{2,40}$/.test(line.text)) {
          const p = parameters[lastParam.idx];
          p.name = [p.name, line.text].join(" ");
          lastParam = { idx: lastParam.idx, lineNo };
          continue;
        }
      }

      const eq = parseEquationLine(line.text);
      if (eq) {
        equations.push({ ...eq, page, reviewed: false });
        continue;
      }
      if (isSpec && unmatched.length < 30) unmatched.push(`p.${page}: ${line.text.slice(0, 110)}`);
    }
  }

  flushBalls();
  flushParams();

  return { pins: dedupePins(pins), parameters, equations, sections, tableHeaders, specLines, unmatched };
}

/**
 * Pines sin encabezado: una lista de líneas numeradas ("1 GND ...", "2 TRIG ...") o de bolas BGA ("A1 VCON ...").
 * Sirve cuando el encabezado de la tabla de pines no se reconoce (otro idioma, otra redacción, OCR).
 * Tolera hasta dos líneas ajenas dentro de la lista y acepta que continúe en la página siguiente.
 */
function detectPinRuns(pages: PageLines[]): Pin[] {
  const found: Pin[] = [];
  for (const pg of pages) {
    let run: Pin[] = [];
    let ballRun: Pin[] = [];
    let gap = 0;
    const closeNumbered = () => {
      const numbers = run.map((p) => p.number);
      const distinct = new Set(numbers).size === run.length;
      // Numeración densa: el rango de números no puede ser mucho mayor que la cantidad de filas.
      const dense = run.length >= 3 && Math.max(...numbers) - Math.min(...numbers) <= run.length + 2 && Math.min(...numbers) >= 1;
      if (distinct && dense) found.push(...run);
      run = [];
    };
    const closeBalls = () => {
      const ids = new Set(ballRun.map((p) => p.role.split(" · ")[0]));
      if (ballRun.length >= 3 && ids.size === ballRun.length) found.push(...ballRun);
      ballRun = [];
    };
    for (const text of pg.lines) {
      const ball = parseBallRow(text);
      const pin = ball ? null : parsePinRow(text);
      if (ball) {
        ballRun.push({ number: 0, name: ball.name, role: [ball.ball, ball.desc].filter(Boolean).join(" · "), page: pg.page, reviewed: false });
        gap = 0;
      } else if (pin && pin.number >= 1 && pin.number <= 128 && /^[A-Z]/.test(pin.name)) {
        run.push({ ...pin, page: pg.page, reviewed: false });
        gap = 0;
      } else if (!/^[a-z(]/.test(text)) {
        // Una línea que continúa la descripción del pin anterior (empieza en minúscula) no cuenta como hueco.
        gap++;
        if (gap > 2) {
          closeNumbered();
          closeBalls();
          gap = 0;
        }
      }
    }
    closeNumbered();
    closeBalls();
  }
  return found;
}

function buildHints(r: Omit<DraftReport, "hints">, counts: { pins: number; params: number; eqs: number }): string[] {
  const hints: string[] = [];
  if (!r.ocr && r.pages > 0 && r.textChars / r.pages < 40) {
    hints.push("Este PDF casi no tiene texto seleccionable. Si es un escaneo, el OCR no pudo leerlo; prueba con un PDF de mejor calidad.");
  }
  if (r.mode === "flexible") {
    hints.push(
      "No reconocí los encabezados de sección habituales (límites absolutos, características eléctricas…), así que leí todas las filas sin depender de ellos. Quedan en «Otros»: clasifícalas o bórralas.",
    );
  }
  if (counts.pins === 0) {
    hints.push("No encontré una tabla de pines. Puedes agregarlos a mano con «+ Agregar pin».");
  }
  if (counts.params === 0 && r.specLines === 0) {
    hints.push(
      "No encontré líneas con un valor y su unidad. Puede que no sea una hoja de datos de componente, o que sus tablas sean imágenes (en ese caso hace falta OCR).",
    );
  } else if (counts.params === 0 && r.specLines > 0) {
    hints.push(`Hay ${r.specLines} líneas con valor y unidad que no pude interpretar como parámetros (ver ejemplos). Puedes agregarlas a mano.`);
  } else if (r.unmatched.length > 0) {
    hints.push(`${r.unmatched.length} líneas con valor y unidad no se convirtieron en filas (ver ejemplos). Si falta algún dato, agrégalo a mano.`);
  }
  if (r.pinsFromRun) {
    hints.push("Los pines salen de una lista numerada sin encabezado de tabla: revisa que sean los correctos.");
  }
  if (r.ocr) {
    hints.push("El texto se obtuvo con OCR, que puede confundir caracteres: verifica cada valor contra la página.");
  }
  if (counts.params > 0 && r.tableHeaders === 0) {
    hints.push("No vi encabezados de columna Min/Typ/Max, así que los valores sueltos no se pueden asignar con seguridad a mínimo, típico o máximo.");
  }
  return hints;
}

/**
 * Construye un análisis en borrador y un informe de lo ocurrido.
 * Primero se lee con los encabezados de sección reconocidos (modo estricto); si así sale muy poco,
 * se vuelve a leer sin depender de ellos (modo flexible).
 * Todo lo que sale de aquí tiene reviewed = false hasta que el usuario lo confirme.
 */
export function buildDraftWithReport(pages: PageLines[], meta: DraftMeta): { analysis: Analysis; report: DraftReport } {
  let pass = runPass(pages, meta, false);
  let mode: "estricto" | "flexible" = "estricto";
  if (pass.parameters.length < 3) {
    const loose = runPass(pages, meta, true);
    if (loose.parameters.length > pass.parameters.length || loose.pins.length > pass.pins.length) {
      pass = loose;
      mode = "flexible";
    }
  }

  let pins = pass.pins;
  let pinsFromRun = false;
  if (pins.length === 0) {
    const run = detectPinRuns(pages);
    if (run.length > 0) {
      pins = dedupePins(run);
      pinsFromRun = true;
    }
  }

  const textChars = pages.reduce((n, p) => n + p.lines.join("").length, 0);
  const base = {
    pages: pages.length,
    textChars,
    ocr: meta.ocr === true,
    mode,
    sections: pass.sections,
    tableHeaders: pass.tableHeaders,
    specLines: pass.specLines,
    unmatched: pass.unmatched,
    pinsFromRun,
  };
  const report: DraftReport = {
    ...base,
    hints: buildHints(base, { pins: pins.length, params: pass.parameters.length, eqs: pass.equations.length }),
  };

  const now = new Date().toISOString();
  const analysis: Analysis = {
    id: `${meta.component}-${meta.hash.slice(0, 8)}`,
    component: meta.component,
    manufacturer: meta.manufacturer,
    datasheet: { hash: meta.hash, pages: meta.pages, fileName: meta.fileName },
    pins,
    parameters: pass.parameters,
    equations: pass.equations,
    netlist: null,
    status: "draft",
    starred: false,
    createdAt: now,
    updatedAt: now,
  };
  return { analysis, report };
}

/** Solo el análisis, sin informe. */
export function buildDraft(pages: PageLines[], meta: DraftMeta): Analysis {
  return buildDraftWithReport(pages, meta).analysis;
}
