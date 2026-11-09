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
  "kV", "℃", "VDC", "VAC", "%/°C", "%/℃", "ppm/°C", "mV/°C", "mV/V", "Vp-p", "mVp-p",
]);

// Signos que se unen al número siguiente. El "-" ASCII suelto y "--" son marcadores de dato ausente.
const SIGN = new Set(["−", "–", "+", "+-", "±"]);
const NUMBER = /^[+-]?\d+(?:\.\d+)?$/;
const PLACEHOLDER = new Set(["—", "–", "-", "--", "---", "–-", "~", "—-", "N/A", "n/a"]);
const SYMBOL_CAPS = /^[A-Z][A-Z0-9_]{0,9}$/;
const SYMBOL_LOWER = /^[a-z]{1,2}[A-Z0-9][A-Za-z0-9_]{0,8}$/;
const TRAILING_SYMBOL = /^(?:[A-Z][A-Z0-9_]{0,9}[+-]?|t[a-z]{1,3}|[a-z]{1,2}[A-Z][A-Za-z0-9_]{0,6})$/;
const STOP_WORDS = new Set(["the", "and", "for", "of", "to", "in", "at", "on", "an", "by", "or", "is", "no", "not", "with"]);
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
  // Páginas de encapsulado: cierran la tabla de pines para que el dibujo no se lea como pines.
  if (/package (dimensions|outline|information|drawing|option)|mechanical (data|drawing)|marking diagram|ordering information|tape and reel|soldering (information|profile)|reel dimensions/i.test(line)) return "other";
  if (/absolute maximum ratings|maximum ratings|limiting values|valores absolutos maximos/i.test(line)) return "absolute-max";
  if (/recommended operating conditions|operating ratings|recommended conditions|condiciones recomendadas/i.test(line)) return "recommended";
  if (/electro-?optical|opto-?electrical|electrical-optical|electrical characteristics|system characteristics|(input|output|general) specifications|caracteristicas electricas/i.test(line)) return "electrical";
  if (/timing (requirements|characteristics)|switching (characteristics|times)|dynamic characteristics|caracteristicas de conmutacion/i.test(line)) return "timing";
  if (/thermal (information|characteristics|properties|metrics)|dissipation ratings|informacion termica/i.test(line)) return "thermal";
  // "10. Characteristics" o "Table 7. Characteristics" a secas.
  if (/^(table\s+\d+\.?\s*)?(\d+(\.\d+)*\.?\s*)?characteristics\s*$/i.test(line.trim())) return "electrical";
  return null;
}

/** Encabezado numerado de otra sección (p. ej. "5.4 Thermal Information"): cierra la sección anterior. */
export function isOtherNumberedHeading(line: string): boolean {
  if (/\.{4,}/.test(line)) return false;
  return /^\d+(\.\d+)*\.?\s+[A-Z][a-z]/.test(line) || /^\d\s+[A-Z][a-z]+(\s[A-Za-z]+)*$/.test(line);
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
    const prevTok = merged[merged.length - 1];
    // Un signo entre dos números ("1.2 – 1.4") es un marcador de dato ausente, no un signo menos.
    const afterNumber = prevTok !== undefined && /^[+\-−–]?\d/.test(prevTok.s);
    if (SIGN.has(t.s) && next && /^\d/.test(next.s) && !afterNumber) {
      const sign = t.s === "+" ? "+" : t.s === "±" || t.s === "+-" ? "±" : "-";
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
    // Subíndice en minúscula tras una sola letra mayúscula ("T stg"), salvo palabras comunes.
    const lowerSub = used === 1 && /^[A-Z]$/.test(first) && /^[a-z][a-z()\-,]{0,7}$/.test(s) && !STOP_WORDS.has(s);
    const continues = (prevSingle && /^[A-Z][A-Z0-9,]*$/.test(s)) || lowerSub || /^_[A-Z0-9_]+$/.test(s) || /^\([A-Za-z0-9]\)$/.test(s);
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
      // Un rango precedido de una condición ("at V CC = 5V to 15V") describe la prueba, no un parámetro.
      const isCondition = head.some((t) => /[=≤≥<>]/.test(t.s)) || CONDITION_WORDS.has(head[0]?.s.toLowerCase() ?? "");
      if (head.length > 0 && !isCondition) return rangeRow(head, Number(n1.s), Number(n2.s), u1.s);
    }
  }

  // Grupo de valores: el primer símbolo de unidad precedido por 1 a 3 valores (números o marcadores)
  // y que no esté seguido de más valores. Lo que sigue a la unidad es la condición de la fila.
  const isValueTok = (s: string) => NUMBER.test(s) || /^±\d/.test(s) || PLACEHOLDER.has(s);
  let unit = "";
  let unitIdx = -1;
  const vals: (number | null)[] = [];
  const valueXc: number[] = [];
  let symmetric = false;
  let i = -1;
  for (let u = 1; u < toks.length; u++) {
    if (!UNITS.has(toks[u].s) || !isValueTok(toks[u - 1].s)) continue;
    const nextTok = toks[u + 1];
    if (nextTok !== undefined && isValueTok(nextTok.s)) continue;
    const gv: (number | null)[] = [];
    const gx: number[] = [];
    let sym = false;
    let j = u - 1;
    while (j >= 0 && gv.length < 3 && isValueTok(toks[j].s)) {
      const s = toks[j].s;
      if (/^±\d/.test(s)) {
        gv.unshift(Number(s.slice(1)));
        sym = true;
      } else if (NUMBER.test(s)) {
        gv.unshift(Number(s));
      } else gv.unshift(null);
      gx.unshift(toks[j].xc);
      j--;
    }
    if (gv.length === 0 || gv.every((v) => v === null)) continue;
    // Lo que sigue a la unidad debe ser una condición ("I F = 20mA"), no prosa ("with a 5 V supply").
    const after = toks.slice(u + 1).map((t) => t.s).join(" ").replace(/^\(\d\)\s*/, "").trim();
    if (after !== "" && !isConditionLine(after)) continue;
    unit = toks[u].s;
    unitIdx = u;
    vals.push(...gv);
    valueXc.push(...gx);
    symmetric = sym;
    i = j;
    break;
  }
  if (unitIdx < 0 || vals.length === 0) return null;
  const tailText = toks.slice(unitIdx + 1).map((t) => t.s).join(" ").replace(/^\(\d\)\s*/, "").trim();

  // Si el valor va unido a una expresión (p. ej. "VCC + 0.3 V"), no es un límite simple.
  const before = toks[i];
  if (before !== undefined && /^[+\-×*/]$/.test(before.s)) return null;

  // Una nota al pie entre el nombre y el valor, como "(2)", no es parte del nombre.
  let head = toks.slice(0, i + 1).filter((t, k, arr) => !(k === arr.length - 1 && /^\(\d\)$/.test(t.s)));
  if (head.length === 0) return null;

  // La condición empieza en la primera palabra de condición o en un comparador.
  let conditions = "";
  let cut = head.findIndex((t, k) => k > 0 && (CONDITION_WORDS.has(t.s.toLowerCase()) || /[=≤≥<>]/.test(t.s)));
  if (cut > 0 && /[=≤≥<>]/.test(head[cut].s)) {
    // La condición empieza en el símbolo que precede al comparador ("... current EN = SW", "V IN = ...").
    let start = cut;
    if (start - 1 > 0 && /^[A-Z][A-Za-z0-9_,]*$/.test(head[start - 1].s)) start--;
    if (start - 1 > 0 && /^[A-Z]$/.test(head[start - 1].s)) start--;
    cut = start;
  }
  if (cut > 0) {
    conditions = head.slice(cut).map((t) => t.s).join(" ");
    head = head.slice(0, cut);
  }

  // Una lista de números de parte ("NA555, NE555, SA555") es el resto de otra fila, no un parámetro.
  if (/^(?:[A-Z]{1,3}\d{2,4}[A-Z]?,?\s*)+$/.test(head.map((t) => t.s).join(" "))) return null;

  let symbol = "";
  const lead = leadingSymbol(head);
  if (head.length === 2 && /^[A-Z]{2,4}$/.test(head[0].s) && /^[A-Z][A-Z0-9()]{1,6}$/.test(head[1].s)) {
    // Fila con solo el símbolo en dos fragmentos ("BV CEO"): el nombre va en otras líneas.
    symbol = head[0].s + head[1].s;
    head = [];
  } else if (lead.used > 0 && head.length > lead.used) {
    symbol = lead.symbol;
    head = head.slice(lead.used);
  } else if (lead.used > 0 && head.length === lead.used && lead.symbol.length >= 3) {
    // Fila con solo el símbolo ("V BP,NEG"): el nombre está en otras líneas, se deja vacío para revisar.
    symbol = lead.symbol;
    head = [];
  } else if (
    head.length >= 3 &&
    /^[A-Z]$/.test(head[head.length - 2].s) &&
    (/^[A-Z]{1,4}$/.test(head[head.length - 1].s) || (/^[a-z]{1,3}$/.test(head[head.length - 1].s) && !STOP_WORDS.has(head[head.length - 1].s)))
  ) {
    // Símbolo al final partido en dos ("Forward Voltage V F", "Input capacitance C in").
    symbol = head[head.length - 2].s + head[head.length - 1].s;
    head = head.slice(0, -2);
  } else if (head.length > 1 && TRAILING_SYMBOL.test(head[head.length - 1].s)) {
    // Símbolo al final del nombre: "Supply voltage V+", "Dropout voltage VDO", "Turn-on time ton".
    symbol = head[head.length - 1].s;
    head = head.slice(0, -1);
  }

  const name = head.map((t) => t.s).join(" ");
  // Prosa y etiquetas de gráficas: nombre en minúscula sin símbolo, o letras sueltas separadas ("L o w - L e v e l").
  if (symbol === "" && /^[a-z]/.test(name)) return null;
  // Viñetas de portada ("• Total power dissipation: ≤ 400 mW"): son características, no filas de tabla.
  if (/^[•·▪■●○-]\s/.test(name) || name.startsWith("•")) return null;
  if (head.filter((t) => t.s.length === 1 && /[A-Za-z]/.test(t.s)).length >= 6) return null;
  // Un nombre sin al menos tres letras (p. ej. "V" o "at V CC") es un fragmento de condición.
  if (symbol === "" && (CONDITION_WORDS.has(head[0].s.toLowerCase()) || name.replace(/[^A-Za-z]/g, "").length < 3)) return null;
  if (symbol !== "" && name !== "" && name.replace(/[^A-Za-z]/g, "").length < 3) return null;
  // Fragmentos de tabla: un nombre con varios números no es un parámetro.
  if (head.filter((t) => NUMBER.test(t.s)).length >= 2) return null;

  const allConditions = [conditions, tailText].filter(Boolean).join(" · ");
  return { symbol, name, conditions: allConditions, values: vals, valueXc, symmetric, range: false, unit };
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
  const multi = line.match(new RegExp(`^([A-Z][A-Za-z0-9]*(?: [A-Z]{1,3})?)\\s+(\\d{1,3})\\s+(\\d{1,3})\\s+(${TYPE})(?:\\s+(.*))?$`));
  if (multi) {
    const type = /^[—–]$/.test(multi[4]) ? "" : multi[4];
    const role = [type, (multi[5] ?? "").trim()].filter(Boolean).join(" · ");
    return { number: Number(multi[2]), name: multi[1].replace(/\s+/g, ""), role };
  }
  const numFirst = line.match(new RegExp(`^(\\d{1,3})\\s+([A-Z][A-Z0-9_\\/+-]{0,11})(?:\\s+(${TYPE})(?=\\s|$))?\\s*[—–-]?\\s*(.*)$`));
  if (numFirst) {
    const role = [numFirst[3] && !/^[—–]$/.test(numFirst[3]) ? numFirst[3] : "", numFirst[4].trim()].filter(Boolean).join(" · ");
    return { number: Number(numFirst[1]), name: numFirst[2], role };
  }
  const nameFirst = line.match(new RegExp(`^([A-Z][A-Z0-9_\\/+-]{0,11})\\s+(\\d{1,3})\\s+(?:(${TYPE})(?:\\s+(.*))?|([A-Za-z].*))$`));
  if (nameFirst) {
    const type = nameFirst[3] && !/^[—–]$/.test(nameFirst[3]) ? nameFirst[3] : "";
    const role = nameFirst[5] ?? [type, (nameFirst[4] ?? "").trim()].filter(Boolean).join(" · ");
    return { number: Number(nameFirst[2]), name: nameFirst[1], role: role.trim() };
  }
  return null;
}

/**
 * Fila de pin de encapsulado BGA: identificador de bola ("A1", "C3") y nombre en mayúsculas.
 * La función del pin puede venir en la misma línea o en líneas cercanas (ver buildDraft).
 */
export function parseBallRow(line: string): { ball: string; name: string; desc: string } | null {
  const m = line.match(/^([A-Z]\d{1,2})\s+([A-Z][A-Z0-9_\/+]{0,11})(?:\s+(.*))?$/);
  if (!m) return null;
  return { ball: m[1], name: m[2], desc: (m[3] ?? "").trim() };
}

/** Línea de ecuación de diseño, p. ej. "t = 0.693 × (R1 + R2) × C". Descarta condiciones de tabla. */
export function parseEquationLine(line: string): ParsedEquation | null {
  const m = line.match(/^(.{1,20}?)\s*=\s*(.+)$/);
  if (!m) return null;
  const rhs = m[2].trim();
  // Los pies de gráficas ("(V OUT = 0.6V) (V OUT = 2.0V)") parten el lado izquierdo con paréntesis sin cerrar.
  if ((m[1].match(/\(/g) ?? []).length !== (m[1].match(/\)/g) ?? []).length) return null;
  if (rhs.length > 120) return null;
  if (/[°,]/.test(rhs)) return null;
  if (!/[×*·/()]/.test(rhs)) return null;
  if (!/\d/.test(rhs) && !/[A-Z]{1,3}\d?/.test(rhs)) return null;
  return { name: m[1].trim(), expr: rhs };
}

/**
 * Línea de condición de prueba, no un parámetro: empieza con una o dos palabras y un comparador
 * ("VCON = 0.13V, FB = 1V", "V IN = 3.7V, V OUT = 1.4V", "VCON < 0.08V") o con un número y un comparador
 * ("2.7V ≤ V IN ≤ 5.5V"). Los parámetros reales tienen un nombre descriptivo antes de la condición.
 */
export function isConditionLine(text: string): boolean {
  // Una línea con multiplicación ("t = 1.1 × R × C") es una ecuación, no una condición de prueba.
  if (/[×·*]/.test(text)) return false;
  return (
    /^[A-Za-z_][A-Za-z0-9_,]*(?:\s[A-Za-z0-9_,]+)?\s*[=<>≤≥]/.test(text) ||
    /^[+\-−–]?\d+(?:\.\d+)?\s?[A-Za-zµμΩ%]*\s*[=<>≤≥]/.test(text)
  );
}

/** Une una línea con solo el nombre de un parámetro y la línea de valores que sigue. */
export function joinLabelLines(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    const isLabel = /^[A-Za-z][A-Za-z ,()\-/]{4,80}$/.test(line.text) && !sectionFromHeader(line.text) && !isOtherNumberedHeading(line.text);
    if (isLabel && next && /^[+\-−–±]?\d/.test(next.text) && !parseParamRow(line.toks)) {
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
