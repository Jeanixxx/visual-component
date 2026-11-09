/**
 * Reglas genéricas para reconocer filas de un datasheet a partir de su texto.
 * Sirven para cualquier fabricante: no dependen de un componente concreto.
 * No usan ningún servicio externo. Todo resultado es un borrador: la revisión es manual.
 *
 * Lo que no se reconoce queda sin extraer; nunca se inventa un valor.
 */
import type { ParamSection } from "../model/schema";

export type Section = ParamSection | "pins";
export type { ParamSection };

/** Unidades frecuentes en datasheets. Se comparan tal cual aparecen en el texto. */
const UNITS = new Set([
  "V", "mV", "µV", "μV", "uV", "A", "mA", "µA", "μA", "uA", "nA", "pA", "kA",
  "W", "mW", "µW", "μW", "kW", "VA",
  "Ω", "mΩ", "kΩ", "MΩ", "ohm", "Ohm",
  "°C", "C", "°F", "K", "°C/W", "K/W", "°C/mW",
  "Hz", "kHz", "MHz", "GHz",
  "s", "ms", "µs", "μs", "us", "ns", "ps",
  "F", "mF", "µF", "μF", "uF", "nF", "pF", "fF",
  "H", "mH", "µH", "μH", "uH", "nH",
  "V/µs", "V/μs", "V/us", "V/ms", "A/µs", "A/μs", "A/us",
  "dB", "dBm", "%", "ppm", "LSB", "bit", "bits", "Vrms", "mVrms", "µVrms", "μVrms", "V/V", "A/V", "V/A",
]);

const DASH_MINUS = /^[–−]/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const SYMBOL_CAPS = /^[A-Z][A-Z0-9_]{0,9}$/;
const SYMBOL_LOWER = /^[a-z]{1,2}[A-Z0-9][A-Za-z0-9_]{0,8}$/;
const TRAILING_SYMBOL = /^(?:[A-Z][A-Z0-9_]{0,9}[+-]?|[A-Z][A-Z0-9_]*[+-]|t[a-z]{1,3}|[a-z]{1,2}[A-Z][A-Za-z0-9_]{0,6})$/;

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

/** Número, guion o "—" (sin dato). Acepta "–" como signo negativo y "±x" como rango simétrico. */
function toNumberToken(tok: string): number | null | "dash" {
  if (tok === "—" || tok === "–" || tok === "-") return "dash";
  const signed = DASH_MINUS.test(tok) ? "-" + tok.slice(1) : tok;
  const plus = signed.startsWith("±") ? signed.slice(1) : signed.startsWith("+-") ? signed.slice(2) : signed;
  return NUMBER.test(plus) ? Number(plus) : null;
}

/** Encabezados de sección en inglés y español. Las líneas de índice (con puntos guía) no cuentan. */
/** Quita tildes y diacríticos para comparar encabezados. */
function plain(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function sectionFromHeader(raw: string): Section | null {
  if (/\.{4,}/.test(raw)) return null;
  const line = plain(raw);
  if (/\b(pin (configuration|functions|description|assignments?)|pinout|pines|terminal functions)\b/i.test(line)) return "pins";
  if (/absolute maximum ratings|valores absolutos m[aá]ximos/i.test(line)) return "absolute-max";
  if (/recommended operating conditions|recommended conditions|condiciones recomendadas/i.test(line)) return "recommended";
  if (/electrical characteristics|caracter[ií]sticas el[eé]ctricas/i.test(line)) return "electrical";
  if (/timing (requirements|characteristics)|switching characteristics|caracter[ií]sticas de conmutaci[oó]n/i.test(line)) return "timing";
  if (/thermal (information|characteristics|metrics)|dissipation ratings|informaci[oó]n t[eé]rmica/i.test(line)) return "thermal";
  return null;
}

/** Encabezado numerado de otra sección (p. ej. "5.4 Thermal Information"): cierra la sección anterior. */
export function isOtherNumberedHeading(line: string): boolean {
  if (/\.{4,}/.test(line)) return false;
  return /^\d+(\.\d+)*\s+[A-Z][a-z]/.test(line) || /^\d\s+[A-Z][a-z]+(\s[A-Za-z]+)*$/.test(line);
}

/** Une un símbolo partido en dos fragmentos ("V" + "CC" -> "VCC", "T" + "stg" -> "Tstg"). */
function mergeSubscript(head: string[]): { symbol: string; rest: string[] } | null {
  if (head.length >= 2 && /^[A-Z]$/.test(head[0]) && /^([A-Z]{1,3}|[a-z]{1,3})$/.test(head[1])) {
    return { symbol: head[0] + head[1], rest: head.slice(2) };
  }
  return null;
}

/**
 * Fila de parámetro: [símbolo] nombre  valores...  unidad
 * Valores: 1, 2 o 3 números. Guion o "—" = sin dato.
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
    if (toks[i].startsWith("±") || toks[i].startsWith("+-")) symmetric = true;
    vals.unshift(v === "dash" ? null : v);
    i--;
  }
  if (vals.length === 0) return null;

  // Si el valor va unido a una expresión (p. ej. "VCC + 0.3 V"), no es un límite simple.
  const before = toks[i];
  if (before !== undefined && /^[+\-×*/]$/.test(before)) return null;

  // Una nota al pie entre el nombre y el valor, como "(2)", no es parte del nombre.
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
  } else if (head.length > 1 && (TRAILING_SYMBOL.test(head[head.length - 1]))) {
    // Símbolo al final del nombre: "Supply voltage V+", "Dropout voltage VDO", "Turn-on time ton".
    symbol = head[head.length - 1];
    head = head.slice(0, -1);
  }

  const name = head.join(" ");
  // Fragmentos de tabla: un nombre con varios números o con "=" no es un parámetro.
  const numericInName = head.filter((t) => NUMBER.test(t)).length;
  if (numericInName >= 2 || name.includes("=")) return null;

  return { symbol, name, values: vals, symmetric, unit };
}

/**
 * Asigna los valores a MIN / TYP / MAX según cuántos hay y en qué sección están.
 * Con dos valores en una tabla eléctrica la columna no se puede saber: no se asignan y se anota para revisar.
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
    // Estas tablas suelen tener columnas MIN y MAX.
    return { min: values[0], typ: null, max: values[1], note: "" };
  }
  if (values.length === 2) {
    const shown = values.map((v) => (v === null ? "—" : String(v))).join(" y ");
    return { ...none, note: `valores ${shown}: columnas no identificadas, revisar` };
  }
  return { ...none, note: "sin valores reconocidos" };
}

/**
 * Fila de tabla de pines. Admite:
 *   "CONT 5 12 Input/output capacitor connection"   (número = primera columna numérica)
 *   "1 GND — Ground"                                (número, nombre, función)
 *   "GND 1 Ground"                                  (nombre, número, función)
 *   "A1 Input Enable"                               (identificador tipo BGA: sin número)
 */
export function parsePinRow(line: string): ParsedPin | null {
  const TYPE = "(?:Input(?:\\/output|\\/Output)?|Output|I\\/O|I|O|P|G|Power|Ground|Analog|Digital|Passive|Open[- ]drain|—|–)";
  const multi = line.match(new RegExp(`^([A-Z][A-Za-z0-9]*(?: [A-Z]{1,3})?)\\s+(\\d{1,3})\\s+(\\d{1,3})\\s+(${TYPE})\\s*(.*)$`));
  if (multi) {
    const type = /^[—–]$/.test(multi[4]) ? "" : multi[4];
    const role = [type, multi[5].trim()].filter(Boolean).join(" · ");
    return { number: Number(multi[2]), name: multi[1].replace(/\s+/g, ""), role };
  }
  const numFirst = line.match(new RegExp(`^(\\d{1,3})\\s+([A-Z][A-Z0-9_\\/+-]{0,11})(?:\\s+(${TYPE}))?\\s*[—–-]?\\s*(.*)$`));
  if (numFirst) {
    const role = [numFirst[3] && !/^[—–]$/.test(numFirst[3]) ? numFirst[3] : "", numFirst[4].trim()].filter(Boolean).join(" · ");
    return { number: Number(numFirst[1]), name: numFirst[2], role };
  }
  const nameFirst = line.match(new RegExp(`^([A-Z][A-Z0-9_\\/+-]{0,11})\\s+(\\d{1,3})\\s+(${TYPE}|[A-Za-z].*)$`));
  if (nameFirst) {
    return { number: Number(nameFirst[2]), name: nameFirst[1], role: nameFirst[3].trim() };
  }
  const bga = line.match(/^([A-Z]\d{1,2})\s+([A-Z][A-Za-z0-9_\/+ -]{1,40})$/);
  if (bga) return { number: 0, name: bga[1], role: bga[2].trim() };
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

/**
 * Une una línea que solo tiene el nombre de un parámetro con la línea de valores que sigue.
 * Ejemplo (datasheets con la tabla partida): "Output high voltage" + "3.3 V" -> "Output high voltage 3.3 V".
 */
export function joinLabelLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    const isLabel = /^[A-Za-z][A-Za-z ,()\-/]{4,80}$/.test(line) && !sectionFromHeader(line) && !isOtherNumberedHeading(line);
    if (isLabel && next && !parseParamRow(line)) {
      const joined = `${line} ${next}`;
      if (parseParamRow(joined)) {
        out.push(joined);
        i++;
        continue;
      }
    }
    out.push(line);
  }
  return out;
}
