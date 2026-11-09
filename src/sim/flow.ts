import type { ResultType } from "eecircuit-engine";

/**
 * Corrientes y cargas acumuladas a partir de los voltajes simulados.
 * Todo sale de la simulación: ninguna corriente se dibuja a mano.
 *
 * Ramas (netlist de ne555.ts):
 *   R1: VCC -> DIS          iR1 = (VCC - DIS) / R1
 *   R2: DIS -> THR          iR2 = (DIS - THR) / R2
 *   S1: DIS -> GND          iS  = iR1 - iR2   (ley de corrientes en DIS)
 *   C : THR -> GND          iC  = iR2         (ley de corrientes en THR)
 */
export interface FlowData {
  t: number[];
  vcc: number[];
  vDis: number[];
  vThr: number[];
  vOut: number[];
  iR1: number[];
  iR2: number[];
  iS: number[];
  iC: number[];
  /** Carga acumulada por rama, en culombios. Define la posición de los puntos que fluyen. */
  qR1: number[];
  qR2: number[];
  qS: number[];
  qC: number[];
  /** Carga que equivale a una separación entre puntos. Escala común a todas las ramas. */
  qUnit: number;
}

function series(res: ResultType, name: string): number[] {
  const s = res.data.find((d) => d.name === name);
  if (!s) throw new Error(`Falta la señal ${name} en la simulación.`);
  return s.values as number[];
}

function cumulative(t: number[], i: number[]): number[] {
  const q = new Array<number>(t.length);
  q[0] = 0;
  for (let k = 1; k < t.length; k++) {
    q[k] = q[k - 1] + 0.5 * (i[k] + i[k - 1]) * (t[k] - t[k - 1]);
  }
  return q;
}

export function buildFlow(res: ResultType, r1: number, r2: number): FlowData {
  const t = series(res, "time");
  const vcc = series(res, "v(vcc)");
  const vDis = series(res, "v(dis)");
  const vThr = series(res, "v(thr)");
  const vOut = series(res, "v(st)");

  const iR1 = t.map((_, k) => (vcc[k] - vDis[k]) / r1);
  const iR2 = t.map((_, k) => (vDis[k] - vThr[k]) / r2);
  const iS = t.map((_, k) => iR1[k] - iR2[k]);
  const iC = iR2;

  const qR1 = cumulative(t, iR1);
  const qR2 = cumulative(t, iR2);
  const qS = cumulative(t, iS);
  const qC = cumulative(t, iC);

  let maxAbs = 0;
  for (const arr of [qR1, qR2, qS, qC]) {
    for (const v of arr) maxAbs = Math.max(maxAbs, Math.abs(v));
  }
  const qUnit = maxAbs > 0 ? maxAbs / 8 : 1e-9;

  return { t, vcc, vDis, vThr, vOut, iR1, iR2, iS, iC, qR1, qR2, qS, qC, qUnit };
}

/** Índice de la última muestra con tiempo <= time (búsqueda binaria). */
export function sampleIndex(t: number[], time: number): number {
  let lo = 0;
  let hi = t.length - 1;
  if (time <= t[0]) return 0;
  if (time >= t[hi]) return hi;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= time) lo = mid;
    else hi = mid;
  }
  return lo;
}
