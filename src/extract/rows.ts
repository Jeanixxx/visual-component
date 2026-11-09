/**
 * Reglas genéricas para reconocer filas de un datasheet a partir de su texto y de la
 * posición de cada palabra. Sirven para cualquier fabricante: no dependen de un componente.
 *
 * Sin servicios externos. Todo resultado es un borrador: la revisión es manual.
 * Lo que no se reconoce queda sin extraer; nunca se inventa un valor.
 */
import type { ParamSection } from "../model/schema";
import type { Token } from "./pdfLines";

export type Section = ParamSection | "pins";
export type { ParamSection };

/** Línea de texto con la posición de sus palabras (si se conoce). */
export interface Line {
  text: string;
  toks: Token[];
}

export function lineFromText(text: string): Line {
  return { text, toks: text.split(/\s+/).filter(Boolean).map((s) => ({ s, xc: NaN })) };
}

/** Unidades frecuentes en datasheets. Se comparan tal cual aparecen en el texto. */
const UNITS = new Set([
  "V", "mV", "µV", "μV", "uV", "A", "mA", "µA", "μA", "uA", "nA", "pA", "kA",
  "W", "mW", "µW", "μW", "kW", "VA", "kVA",
  "Ω", "mΩ", "kΩ", "MΩ", "ohm", "Ohm", "kohm", "kOhm",
  "°C", "C", "°F", "K", "°C/W", "K/W", "°C/mW",
  "Hz", "kHz", "MHz", "GHz", "KHz",
  "s", "ms", "µs", "μs", "us", "ns", "ps",
  "F", "mF", "µF", "μF", "uF", "nF", "pF", "fF",
  "H", "mH", "µH", "μH", "uH", "nH",
  "V/µs", "V/μs", "V/us", "V/ms", "A/µs", "A/μs", "A/us",
  "dB", "dBm", "%", "ppm", "LSB", "bit", "bits", "Vrms", "mVrms", "µVrms", "μVrms", "V/V", "A/V", "V/A",
  "kV",
]);

const SIGN = new Set(["−", "–", "-", "+", "+-", "±"]);
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const SYMBOL_CAPS = /^[A-Z][A-Z0-9_]{0,9}$/;
const SYMBOL_LOWER = /^[a-z]{1,2}[A-Z0-9][A-Za-z0-9_]{0,8}$/;
const TRAILING_SYMBOL = /^(?:[A-Z][A-Z0-9_]{0,9}[+-]?|t[a-z]{1,3}|[a-z]{1,2}[A-Z][A-Za-z0-9_]{0,6})$/;
const CONDITION_WORDS = new Set(["at", "for", "with", "when", "over", "from", "under", "between"]);

export interface ParsedParam {
  symbol: string;
  name: string;
  /** Condición de la tabla, si la fila la tiene (p. ej. "VCON = 0.16V"). */
  conditions: string;
  values: (number | null)[];
  /** Posición horizontal de cada valor, si el PDF la da. */
  valueXc: number[];
  symmetric: boolean;
  /** true si la fila es un rango "X to Y". */
  range: boolean;
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

/** Posición horizontal de las columnas Min / Typ / Max de una tabla. */
export interface Columns {
  min?: number;
  typ?: number;
  max?: number;
}

/** Quita tildes y diacríticos para comparar encabezados. */
function plain(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Encabezados de sección en inglés y español. Las líneas de índice (con puntos guía) no cuentan. */
export function sectionFromHeader(raw: string): Section | null {
  if (/\.{4,}/.test(raw)) return null;
  const line = plain(raw);
  if (/\b(pin (configuration|functions?|descriptions?|assignments?)|pinout|pines|terminal functions)\b/i.test(line)) return "pins";
  if (/absolute maximum ratings|valores absolutos maximos/i.test(line)) return "absolute-max";
  if (/recommended operating conditions|operating ratings|recommended conditions|condiciones recomendadas/i.test(line)) return "recommended";
  if (/electrical characteristics|caracteristicas electricas/i.test(line)) return "electrical";
  if (/timing (requirements|characteristics)|switching characteristics|caracteristicas de conmutacion/i.test(line)) return "timing";
  if (/thermal (information|characteristics|properties|metrics)|dissipation ratings|informacion termica/i.test(line)) return "thermal";
  return null;
}

/** Encabezado numerado de otra sección (p. ej. "5.4 Thermal Information"): cierra la sección anterior. */
export function isOtherNumberedHeading(line: string): boolean {
  if (/\.{4,}/.test(line)) return false;
  return /^\d+(\.\d+)*\s+[A-Z][a-z]/.test(line) || /^\d\s+[A-Z][a-z]+(\s[A-Za-z]+)*$/.test(line);
}

/** Encabezado de tabla con columnas Min / Typ / Max. Devuelve la posición de cada una. */
export function headerColumns(toks: Token[]): Columns | null {
  const cols: Columns = {};
  for (const t of toks) {
    const w = plain(t.s).toLowerCase().replace(/\.$/, "");
    if (w === "min") cols.min = t.xc;
    else if (w === "typ" || w === "typical") cols.typ = t.xc;
    else if (w === "max") cols.max = t.xc;
  }
  const found = [cols.min, cols.typ, cols.max].filter((x) => x !== undefined).length;
  return found >= 2 ? cols : null;
}

/**
 * Normaliza palabras: une signos sueltos con el número ("−" + "65" -> "-65"),
 * separa unidades pegadas ("+150°C" -> "+150" "°C") y une "m" + "Ω". Conserva la posición.
 */
function normalize(toks: Token[]): Token[] {
  // Pasada 1: une signos sueltos con el número y "m" + "Ω".
  const merged: Token[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const next = toks[i + 1];
    if (SIGN.has(t.s) && next && /^\d/.test(next.s)) {
      const sign = t.s === "+" ? "+" : t.s === "±" ? "±" : "-";
      merged.push({ s: sign + next.s, xc: next.xc });
      i++;
      continue;
    }
    if (t.s === "m" && next && next.s === "Ω") {
      merged.push({ s: "mΩ", xc: t.xc });
      i++;
      continue;
    }
    merged.push(t);
  }
  // Pasada 2: separa unidades pegadas al número y normaliza el signo menos.
  const out: Token[] = [];
  for (const t of merged) {
    const m = t.s.match(/^([+−–±-]?\d+(?:\.\d+)?)(°C|°F|[A-Za-zµμΩ%]+)$/);
    if (m && UNITS.has(m[2])) {
      out.push({ s: m[1].replace(/^[−–]/, "-"), xc: t.xc }, { s: m[2], xc: t.xc });
    } else {
      out.push({ s: t.s.replace(/^[−–]/, "-"), xc: t.xc });
    }
  }
  return out;
}

/**
 * Símbolo al inicio de la fila de una tabla: "V FB,MIN", "I Q _PWM", "R DSON (P)", "VIH".
 * Varias letras sueltas seguidas forman un solo símbolo; "VIH EN," no arrastra "EN,".
 */
function leadingSymbol(toks: Token[]): { symbol: string; used: number } {
  if (toks.length === 0) return { symbol: "", used: 0 };
  const first = toks[0].s;
  if (!(SYMBOL_CAPS.test(first) || SYMBOL_LOWER.test(first))) return { symbol: "", used: 0 };
  let symbol = first;
  let used = 1;
  let prevSingle = /^[A-Z]$/.test(first);
  while (used < toks.length && used < 4) {
    const s = toks[used].s;
    const continues = (prevSingle && /^[A-Z][A-Z0-9,]*$/.test(s)) || /^_[A-Z0-9_]+$/.test(s) || /^\([A-Za-z0-9]\)$/.test(s);
    if (!continues) break;
    symbol += s;
    prevSingle = /^[A-Z]$/.test(s);
    used++;
  }
  return { symbol, used };
}

/** Rango "X unidad to Y unidad" (p. ej. "2.7V to 5.5V", "VIN to SGND −0.2V to +6.0V"). */
function rangeRow(head: Token[], min: number, max: number, unit: string): ParsedParam {
  let symbol = "";
  let h = head;
  const lead = leadingSymbol(head);
  if (lead.used > 0 && head.length > lead.used) {
    symbol = lead.symbol;
    h = head.slice(lead.used);
  }
  return {
    symbol,
    name: h.map((t) => t.s).join(" "),
    conditions: "",
    values: [min, max],
    valueXc: [NaN, NaN],
    symmetric: false,
    range: true,
    unit,
  };
}

/**
 * Fila de parámetro: [símbolo] nombre [condición] valores... unidad
 * Acepta 1, 2 o 3 valores, guion o "—" como dato ausente, "±x" como rango simétrico y rangos "X to Y".
 */
export function parseParamRow(input: string | Token[]): ParsedParam | null {
  const raw: Token[] = typeof input === "string" ? lineFromText(input).toks : input;
  const toks = normalize(raw);
  if (toks.length < 3) return null;

  // Rango "X unidad to Y unidad": se busca el "to" que tiene números y unidades a ambos lados.
  for (let k = 2; k + 2 < toks.length; k++) {
    if (toks[k].s.toLowerCase() !== "to") continue;
    const n1 = toks[k - 2];
    const u1 = toks[k - 1];
    const n2 = toks[k + 1];
    const u2 = toks[k + 2];
    if (NUMBER.test(n1.s) && UNITS.has(u1.s) && NUMBER.test(n2.s) && UNITS.has(u2.s) && u1.s === u2.s) {
      const head = toks.slice(0, k - 2);
      if (head.length > 0) return rangeRow(head, Number(n1.s), Number(n2.s), u1.s);
    }
  }

  const unit = toks[toks.length - 1].s;
  if (!UNITS.has(unit)) return null;

  const vals: (number | null)[] = [];
  const valueXc: number[] = [];
  let symmetric = false;
  let i = toks.length - 2;
  while (i >= 0 && vals.length < 3) {
    const s = toks[i].s;
    if (s === "—" || s === "–") {
      vals.unshift(null);
      valueXc.unshift(toks[i].xc);
    } else if (NUMBER.test(s)) {
      vals.unshift(Number(s));
      valueXc.unshift(toks[i].xc);
    } else {
      break;
    }
    i--;
  }
  if (vals.length === 0) return null;

  // Si el valor va unido a una expresión (p. ej. "VCC + 0.3 V"), no es un límite simple.
  const before = toks[i];
  if (before !== undefined && /^[+\-×*/]$/.test(before.s)) return null;

  // Una nota al pie entre el nombre y el valor, como "(2)", no es parte del nombre.
  let head = toks.slice(0, i + 1).filter((t, k, arr) => !(k === arr.length - 1 && /^\(\d\)$/.test(t.s)));
  if (head.length === 0) return null;

  // La condición empieza en la primera palabra de condición o en un comparador.
  let conditions = "";
  const cut = head.findIndex((t, k) => k > 0 && (CONDITION_WORDS.has(t.s.toLowerCase()) || /[=≤≥<>]/.test(t.s)));
  if (cut > 0) {
    conditions = head.slice(cut).map((t) => t.s).join(" ");
    head = head.slice(0, cut);
  }

  let symbol = "";
  const lead = leadingSymbol(head);
  if (lead.used > 0 && head.length > lead.used) {
    symbol = lead.symbol;
    head = head.slice(lead.used);
  } else if (head.length > 1 && TRAILING_SYMBOL.test(head[head.length - 1].s)) {
    // Símbolo al final del nombre: "Supply voltage V+", "Dropout voltage VDO", "Turn-on time ton".
    symbol = head[head.length - 1].s;
    head = head.slice(0, -1);
  }

  const name = head.map((t) => t.s).join(" ");
  // Un nombre sin al menos tres letras (p. ej. "V" o "at V CC") es un fragmento de condición.
  if (CONDITION_WORDS.has(head[0].s.toLowerCase()) || name.replace(/[^A-Za-z]/g, "").length < 3) return null;
  // Fragmentos de tabla: un nombre con varios números no es un parámetro.
  if (head.filter((t) => NUMBER.test(t.s)).length >= 2) return null;

  return { symbol, name, conditions, values: vals, valueXc, symmetric, range: false, unit };
}

/**
 * Asigna los valores a MIN / TYP / MAX.
 * 1. Si la tabla tiene encabezado Min/Typ/Max y los valores tienen posición, usa la columna más cercana.
 * 2. Si no, según cuántos valores hay y en qué sección están.
 * Con dos valores en una tabla eléctrica sin columnas no se asigna nada: se anota para revisar.
 */
export function assignLimits(
  section: ParamSection,
  p: Pick<ParsedParam, "values" | "valueXc" | "symmetric" | "range">,
  columns: Columns | null,
): { min: number | null; typ: number | null; max: number | null; note: string } {
  const none = { min: null, typ: null, max: null, note: "" };
  const { values, valueXc, symmetric } = p;

  if (p.range) return { min: values[0], typ: null, max: values[1], note: "" };

  if (columns && values.length > 0 && valueXc.every((x) => Number.isFinite(x))) {
    const slots: Record<"min" | "typ" | "max", number | undefined> = { min: columns.min, typ: columns.typ, max: columns.max };
    const out: { min: number | null; typ: number | null; max: number | null; note: string } = { ...none };
    const taken = new Set<string>();
    let ok = true;
    values.forEach((v, idx) => {
      if (v === null) return;
      let best: "min" | "typ" | "max" | null = null;
      let bestD = Infinity;
      for (const key of ["min", "typ", "max"] as const) {
        const x = slots[key];
        if (x === undefined) continue;
        const d = Math.abs(valueXc[idx] - x);
        if (d < bestD) {
          bestD = d;
          best = key;
        }
      }
      if (best === null || bestD > 40 || taken.has(best)) ok = false;
      else {
        taken.add(best);
        out[best] = v;
      }
    });
    if (ok) return { ...out, note: "columna por posición en la tabla" };
  }

  if (values.length === 3) return { min: values[0], typ: values[1], max: values[2], note: "" };
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
 *   "A1 VCON"                                       (identificador tipo BGA; la función puede venir en otras líneas)
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

/** Une una línea con solo el nombre de un parámetro y la línea de valores que sigue. */
export function joinLabelLines(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    const isLabel = /^[A-Za-z][A-Za-z ,()\-/]{4,80}$/.test(line.text) && !sectionFromHeader(line.text) && !isOtherNumberedHeading(line.text);
    if (isLabel && next && !parseParamRow(line.toks)) {
      const joined: Line = { text: `${line.text} ${next.text}`, toks: [...line.toks, ...next.toks] };
      if (parseParamRow(joined.toks)) {
        out.push(joined);
        i++;
        continue;
      }
    }
    out.push(line);
  }
  return out;
}
