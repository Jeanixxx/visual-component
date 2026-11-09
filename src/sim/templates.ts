/**
 * Plantillas de simulación. Cada circuito define sus parámetros, su netlist SPICE
 * y cómo se compara el resultado con la ecuación de su datasheet.
 *
 * El motor (runSim) y la gráfica no saben nada de un circuito concreto:
 * todo lo específico vive aquí.
 */
import type { ResultType } from "eecircuit-engine";
import { astableNetlist, expectedTimes, DEFAULT_ASTABLE } from "./ne555";
import { measureAstable, readWaveform, relativeError } from "./measure";

export interface TemplateParam {
  key: string;
  label: string;
  unit: string;
  default: number;
}

export interface Measure {
  label: string;
  unit: string;
  measured: number | null;
  expected: number | null;
  /** Error relativo en %, si hay medida y referencia. */
  errorPct: number | null;
  /** Tolerancia para dar el resultado por bueno, en %. */
  tolerancePct: number;
  note?: string;
}

export interface SimTemplate {
  id: string;
  title: string;
  /** Ecuación o referencia del datasheet que se verifica. */
  reference: string;
  disclaimer: string;
  params: TemplateParam[];
  /** Señales que se grafican por defecto, en el formato de ngspice: v(nodo). */
  signals: string[];
  netlist(values: Record<string, number>): string;
  measure(res: ResultType, values: Record<string, number>): Measure[];
}

function series(res: ResultType, name: string): number[] {
  const s = res.data.find((d) => d.name === name);
  if (!s) throw new Error(`Falta la señal ${name} en la simulación.`);
  return s.values as number[];
}

function mkMeasure(
  label: string,
  unit: string,
  measured: number | null,
  expected: number | null,
  tolerancePct: number,
  note?: string,
): Measure {
  const errorPct =
    measured !== null && expected !== null && expected !== 0 ? relativeError(measured, expected) : null;
  return { label, unit, measured, expected, errorPct, tolerancePct, note };
}

const ne555Astable: SimTemplate = {
  id: "ne555-astable",
  title: "NE555 · astable",
  reference: "t_alto ≈ 0.693·(R1+R2)·C y t_bajo ≈ 0.693·R2·C",
  disclaimer:
    "Modelo ideal basado en el diagrama de bloques del datasheet. No es el modelo del fabricante: ignora tolerancias, retardos internos y la caída de tensión en la salida.",
  params: [
    { key: "vcc", label: "VCC", unit: "V", default: DEFAULT_ASTABLE.vcc },
    { key: "r1", label: "R1", unit: "Ω", default: DEFAULT_ASTABLE.r1 },
    { key: "r2", label: "R2", unit: "Ω", default: DEFAULT_ASTABLE.r2 },
    { key: "c", label: "C", unit: "F", default: DEFAULT_ASTABLE.c },
  ],
  signals: ["v(st)", "v(thr)"],
  netlist: (v) => astableNetlist({ vcc: v.vcc, r1: v.r1, r2: v.r2, c: v.c }),
  measure(res, v) {
    const p = { vcc: v.vcc, r1: v.r1, r2: v.r2, c: v.c };
    const exp = expectedTimes(p);
    const m = measureAstable(readWaveform(res));
    // El primer alto parte de un condensador descargado: se excluye de la comparación.
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const high = mean(m.highs.slice(1));
    const low = mean(m.lows.slice(1));
    return [
      mkMeasure("t_alto", "s", high, exp.high, 5, "excluye el primer intervalo (condensador descargado)"),
      mkMeasure("t_bajo", "s", low, exp.low, 5),
    ];
  },
};

const rcLowPass: SimTemplate = {
  id: "rc-lowpass",
  title: "Filtro RC paso bajo",
  reference: "τ = R·C; la salida alcanza el 63.2 % de la entrada en t = τ",
  disclaimer: "Circuito ideal: fuente sin resistencia interna y condensador sin fugas.",
  params: [
    { key: "vin", label: "Vin", unit: "V", default: 5 },
    { key: "r", label: "R", unit: "Ω", default: 1000 },
    { key: "c", label: "C", unit: "F", default: 10e-6 },
  ],
  signals: ["v(in)", "v(out)"],
  netlist(v) {
    const tau = v.r * v.c;
    const tstep = tau / 400;
    const tstop = tau * 6;
    return `RC paso bajo
V1 in 0 PULSE(0 ${v.vin} 0 1n 1n 1 2)
R1 in out ${v.r}
C1 out 0 ${v.c} IC=0
.tran ${tstep.toPrecision(6)} ${tstop.toPrecision(6)}
.end`;
  },
  measure(res, v) {
    const t = series(res, "time");
    const out = series(res, "v(out)");
    const target = 0.632 * v.vin;
    let tau: number | null = null;
    for (let i = 1; i < out.length; i++) {
      if (out[i - 1] < target && out[i] >= target) {
        // Interpolación lineal entre las dos muestras que cruzan el umbral.
        const f = (target - out[i - 1]) / (out[i] - out[i - 1]);
        tau = t[i - 1] + f * (t[i] - t[i - 1]);
        break;
      }
    }
    return [mkMeasure("τ", "s", tau, v.r * v.c, 2)];
  },
};

const customNetlist: SimTemplate = {
  id: "custom",
  title: "Netlist libre",
  reference: "Sin ecuación de referencia: se muestran las señales que indiques.",
  disclaimer: "Escribe un netlist en formato SPICE (ngspice). Incluye una línea .tran para obtener resultados en el tiempo.",
  params: [],
  signals: [],
  netlist: () => "",
  measure: () => [],
};

export const TEMPLATES: SimTemplate[] = [ne555Astable, rcLowPass, customNetlist];

export function templateById(id: string): SimTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? ne555Astable;
}
