import type { ResultType } from "eecircuit-engine";

export interface Waveform {
  t: number[];
  out: number[];
  thr: number[];
}

export interface AstableMeasure {
  waveform: Waveform;
  /** Duraciones de cada intervalo en alto y en bajo, en segundos. */
  highs: number[];
  lows: number[];
}

/** Extrae el tiempo y las señales de salida (v(st)) y del condensador (v(thr)). */
export function readWaveform(res: ResultType): Waveform {
  const get = (name: string): number[] => {
    const series = res.data.find((d) => d.name === name);
    if (!series) throw new Error(`Falta la señal ${name} en la simulación.`);
    return series.values as number[];
  };
  return { t: get("time"), out: get("v(st)"), thr: get("v(thr)") };
}

/**
 * Mide los intervalos en alto y en bajo de la salida, cruzando el 50 % de su rango.
 * Cada cruce hacia arriba o hacia abajo marca el inicio de un intervalo.
 */
export function measureAstable(w: Waveform): AstableMeasure {
  const max = Math.max(...w.out);
  const min = Math.min(...w.out);
  const mid = (max + min) / 2;

  const crossings: { t: number; up: boolean }[] = [];
  for (let i = 1; i < w.out.length; i++) {
    const before = w.out[i - 1];
    const after = w.out[i];
    if (before < mid && after >= mid) crossings.push({ t: w.t[i], up: true });
    if (before >= mid && after < mid) crossings.push({ t: w.t[i], up: false });
  }

  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 0; i + 1 < crossings.length; i++) {
    const dt = crossings[i + 1].t - crossings[i].t;
    (crossings[i].up ? highs : lows).push(dt);
  }
  return { waveform: w, highs, lows };
}

/** Error relativo en porcentaje, sobre el primer intervalo completo de cada tipo. */
export function relativeError(measured: number, expected: number): number {
  return ((measured - expected) / expected) * 100;
}
