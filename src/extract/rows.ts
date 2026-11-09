/**
 * Reglas locales para reconocer filas de un datasheet a partir de su texto.
 * No usa ningún servicio externo. Todo resultado es un borrador: la revisión es manual.
 *
 * Probadas contra el datasheet real del NE555 (TI, SLFS022K). Las tablas reales
 * tienen subíndices en fragmentos separados ("V CC"), signos negativos con guion
 * largo ("–65") y condiciones partidas en varias líneas: lo que no se reconoce
 * queda sin extraer, no se inventa.
 */
import type { ParamSection } from "../model/schema";

export type Section = ParamSection | "pins";
export type { ParamSection };

const UNITS = new Set([
  "V", "mV", "A", "mA", "µA", "μA", "uA", "nA", "W", "mW",
  "Ω", "kΩ", "MΩ", "°C", "Hz", "kHz", "MHz",
  "ns", "µs", "μs", "us", "ms", "s", "%", "pF", "nF", "µF", "μF", "uF", "F", "mF",
  "V/µs", "V/us", "dB", "°C/W",
]);

const DASH_MINUS = /^[–−]/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const SYMBOL_CAPS = /^[A-Z][A-Z0-9_]{0,9}$/;
const SYMBOL_LOWER = /^[a-z]{1,2}[A-Z0-9][A-Za-z0-9_]{0,8}$/;

export interface ParsedParam {
  symbol: string;
  name: string;
  values: (number | null)[];
  symmetric: boolean;
  unit: string;
}

export interface ParsedPin {
  number: number;
  name: string;
  role: string;
}

export interface ParsedEquation {
  name: string;
  expr: string;
}

/** Quita el "–" o "−" inicial y lo convierte en signo negativo. Devuelve null si no es número. */
function toNumberToken(tok: string): number | null | "dash" {
  if (tok === "—" || tok === "–" || tok === "-") return "dash";
  const signed = DASH_MINUS.test(tok) ? "-" + tok.slice(1) : tok;
  const plus = signed.startsWith("±") ? signed.slice(1) : signed;
  return NUMBER.test(plus) ? Number(plus) : null;
}

/** Encabezados de sección. Las líneas de índice (con puntos guía) no cuentan. */
export function sectionFromHeader(line: string): Section | null {
  if (/\.{4,}/.test(line)) return null;
  if (/pin (configuration and )?functions/i.test(line)) return "pins";
  if (/absolute maximum ratings/i.test(line)) return "absolute-max";
  if (/recommended operating conditions/i.test(line)) return "recommended";
  if (/electrical characteristics/i.test(line)) return "electrical";
  return null;
}

/** Encabezado numerado de otra sección (p. ej. "5.4 Thermal Information"): cierra la sección anterior. */
export function isOtherNumberedHeading(line: string): boolean {
  if (/\.{4,}/.test(line)) return false;
  return /^\d+\.\d+\s+[A-Z][a-z]/.test(line) || /^\d\s+[A-Z][a-z]+(\s[A-Za-z]+)*$/.test(line);
}

/**
 * Une un símbolo partido en dos fragmentos ("V" + "CC" -> "VCC", "T" + "stg" -> "Tstg").
 * Solo si el segundo fragmento es corto: así "V Supply voltage" no se une.
 */
function mergeSubscript(head: string[]): { symbol: string; rest: string[] } | null {
  if (head.length >= 2 && /^[A-Z]$/.test(head[0]) && /^([A-Z]{1,3}|[a-z]{1,3})$/.test(head[1])) {
    return { symbol: head[0] + head[1], rest: head.slice(2) };
  }
  return null;
}

/**
 * Fila de parámetro: [símbolo] nombre  valores...  unidad
 * Valores: 1 (típico, o ±x como rango simétrico), 2 (mín, máx) o 3 (mín, típ, máx).
 * Guion o "—" = sin dato. Ejemplos: "VCC Supply voltage 4.5 16 V", "V CC Supply voltage (2) 18 V".
 */
export function parseParamRow(line: string): ParsedParam | null {
  const toks = line.trim().split(/\s+/);
  if (toks.length < 3) return null;

  const unit = toks[toks.length - 1];
  if (!UNITS.has(unit)) return null;

  const vals: (number | null)[] = [];
  let symmetric = false;
  let i = toks.length - 2;
  while (i >= 0 && vals.length < 3) {
    const v = toNumberToken(toks[i]);
    if (v === null) break;
    if (toks[i].startsWith("±")) symmetric = true;
    vals.unshift(v === "dash" ? null : v);
    i--;
  }
  if (vals.length === 0) return null;

  // Si el valor va unido a una expresión (p. ej. "VCC + 0.3 V"), no es un límite simple.
  const before = toks[i];
  if (before !== undefined && /^[+\-×*/]$/.test(before)) return null;

  // Un nota al pie entre el nombre y el valor, como "(2)", no es parte del nombre.
  let head = toks.slice(0, i + 1).filter((t, k, arr) => !(k === arr.length - 1 && /^\(\d\)$/.test(t)));
  if (head.length === 0) return null;

  let symbol = "";
  const merged = mergeSubscript(head);
  if (merged) {
    symbol = merged.symbol;
    head = merged.rest.length > 0 ? merged.rest : head;
  } else if (head.length > 1 && (SYMBOL_CAPS.test(head[0]) || SYMBOL_LOWER.test(head[0]))) {
    symbol = head[0];
    head = head.slice(1);
  }

  const name = head.join(" ");
  // Fragmentos de tabla: un nombre con varios números o con "=" no es un parámetro.
  const numericInName = head.filter((t) => NUMBER.test(t)).length;
  if (numericInName >= 2 || name.includes("=")) return null;

  return { symbol, name, values: vals, symmetric, unit };
}

/**
 * Asigna los valores a MIN / TYP / MAX según cuántos hay y en qué sección están.
 * Con dos valores la columna no se puede saber: no se asignan y se anota para revisar.
 */
export function assignLimits(
  section: ParamSection,
  values: (number | null)[],
  symmetric: boolean,
): { min: number | null; typ: number | null; max: number | null; note: string } {
  const none = { min: null, typ: null, max: null, note: "" };
  if (values.length === 3) {
    return { min: values[0], typ: values[1], max: values[2], note: "" };
  }
  if (values.length === 1) {
    const v = values[0];
    if (v === null) return none;
    if (symmetric) return { min: -v, typ: null, max: v, note: "" };
    if (section === "absolute-max") return { ...none, max: v };
    return { ...none, typ: v, note: "columna MIN/TYP/MAX no identificada" };
  }
  if (values.length === 2 && (section === "absolute-max" || section === "recommended")) {
    // Estas tablas tienen columnas MIN y MAX.
    return { min: values[0], typ: null, max: values[1], note: "" };
  }
  if (values.length === 2) {
    const shown = values.map((v) => (v === null ? "—" : String(v))).join(" y ");
    return { ...none, note: `valores ${shown}: columnas no identificadas, revisar` };
  }
  return { ...none, note: "sin valores reconocidos" };
}

/**
 * Fila de tabla de pines (Table 4-1 del NE555):
 *   "CONT 5 12 Input/output capacitor connection"  -> número 5 (columna D)
 *   "V CC 8 20 — Input supply voltage"             -> nombre VCC
 * También acepta "1 GND — Ground" (formato simple).
 */
export function parsePinRow(line: string): ParsedPin | null {
  const full = line.match(/^([A-Z][A-Za-z0-9]*(?: [A-Z]{1,3})?)\s+(\d{1,2})\s+(\d{1,2})\s+(—|Input(?:\/output)?|Output)\s*(.*)$/);
  if (full) {
    const type = full[4] === "—" ? "" : full[4];
    const role = [type, full[5].trim()].filter(Boolean).join(" · ");
    return { number: Number(full[2]), name: full[1].replace(/\s+/g, ""), role };
  }
  const simple = line.match(/^(\d{1,2})\s+([A-Z][A-Z0-9_]{0,7})(?:\s+[—–-])?\s*(.*)$/);
  if (simple) return { number: Number(simple[1]), name: simple[2], role: simple[3].trim() };
  return null;
}

/** Línea de ecuación de diseño, p. ej. "t = 0.693 × (R1 + R2) × C". Descarta condiciones de tabla. */
export function parseEquationLine(line: string): ParsedEquation | null {
  const m = line.match(/^(.{1,20}?)\s*=\s*(.+)$/);
  if (!m) return null;
  const rhs = m[2].trim();
  if (rhs.length > 120) return null;
  if (/[°,]/.test(rhs)) return null;
  if (!/[×*·/()]/.test(rhs)) return null;
  if (!/\d/.test(rhs) && !/[A-Z]{1,3}\d?/.test(rhs)) return null;
  return { name: m[1].trim(), expr: rhs };
}
