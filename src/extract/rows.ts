/**
 * Reglas locales para reconocer filas de un datasheet a partir de su texto.
 * No usa ningún servicio externo. Todo resultado es un borrador: la revisión es manual.
 */
import type { ParamSection } from "../model/schema";

export type Section = ParamSection | "pins";

const UNITS = new Set([
  "V", "mV", "A", "mA", "µA", "uA", "nA", "W", "mW",
  "Ω", "kΩ", "MΩ", "°C", "Hz", "kHz", "MHz",
  "ns", "µs", "us", "ms", "s", "%", "pF", "nF", "µF", "uF", "F", "mF",
  "V/µs", "V/us", "dB",
]);

const NUMBER = /^-?\d+(?:\.\d+)?$/;
const DASH = /^[—–-]$/;
const SYMBOL_CAPS = /^[A-Z][A-Z0-9_]{0,9}$/;
const SYMBOL_LOWER = /^[a-z]{1,2}[A-Z0-9][A-Za-z0-9_]{0,8}$/;

export interface ParsedParam {
  symbol: string;
  name: string;
  min: number | null;
  typ: number | null;
  max: number | null;
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

/** Detecta encabezados de sección. Devuelve la sección que empieza en esa línea. */
export function sectionFromHeader(line: string): Section | null {
  if (/absolute maximum ratings/i.test(line)) return "absolute-max";
  if (/recommended operating conditions/i.test(line)) return "recommended";
  if (/electrical characteristics/i.test(line)) return "electrical";
  if (/pin (configuration and )?functions/i.test(line)) return "pins";
  return null;
}

/**
 * Fila de parámetro: [símbolo] nombre  valores...  unidad
 * Valores: 1 (típico), 2 (mín, máx) o 3 (mín, típ, máx). Guion = sin dato.
 * Ejemplo: "VCC Supply voltage 4.5 16 V"
 */
export function parseParamRow(line: string): ParsedParam | null {
  const toks = line.trim().split(/\s+/);
  if (toks.length < 3) return null;

  const unit = toks[toks.length - 1];
  if (!UNITS.has(unit)) return null;

  const vals: (number | null)[] = [];
  let i = toks.length - 2;
  while (i >= 0 && vals.length < 3 && (NUMBER.test(toks[i]) || DASH.test(toks[i]))) {
    vals.unshift(DASH.test(toks[i]) ? null : Number(toks[i]));
    i--;
  }
  if (vals.length === 0) return null;

  // Si el valor va unido a una expresión (p. ej. "VCC + 0.3 V"), no es un límite simple.
  const before = toks[i];
  if (before !== undefined && /^[+\-×*/]$/.test(before)) return null;

  const head = toks.slice(0, i + 1);
  if (head.length === 0) return null;

  let symbol = "";
  let nameToks = head;
  if (head.length > 1 && (SYMBOL_CAPS.test(head[0]) || SYMBOL_LOWER.test(head[0]))) {
    symbol = head[0];
    nameToks = head.slice(1);
  }

  let min: number | null = null;
  let typ: number | null = null;
  let max: number | null = null;
  if (vals.length === 1) {
    typ = vals[0];
  } else if (vals.length === 2) {
    min = vals[0];
    max = vals[1];
  } else {
    min = vals[0];
    typ = vals[1];
    max = vals[2];
  }

  return { symbol, name: nameToks.join(" "), min, typ, max, unit };
}

/** Fila de tabla de pines: "1 GND — Ground" o "2 TRIG Trigger input". */
export function parsePinRow(line: string): ParsedPin | null {
  const m = line.match(/^(\d{1,2})\s+([A-Z][A-Z0-9_]{0,7})(?:\s+[—–-])?\s*(.*)$/);
  if (!m) return null;
  return { number: Number(m[1]), name: m[2], role: m[3].trim() };
}

/** Línea de ecuación de diseño: "t = 0.693 × (R1 + R2) × C". */
export function parseEquationLine(line: string): ParsedEquation | null {
  const m = line.match(/^(.{1,40}?)\s*=\s*(.+)$/);
  if (!m) return null;
  const rhs = m[2].trim();
  if (rhs.length > 120) return null;
  if (!/[×*·/+()]/.test(rhs)) return null;
  return { name: m[1].trim(), expr: rhs };
}
