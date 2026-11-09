/**
 * Netlist del NE555 en configuración astable.
 *
 * Modelo IDEAL basado en el diagrama de bloques del datasheet:
 * - Comparadores en 1/3 y 2/3 de VCC.
 * - Biestable (aquí: un condensador de estado con interruptores de set/reset).
 * - Transistor de descarga como interruptor en el pin DIS.
 *
 * No es el modelo SPICE del fabricante. No incluye tolerancias, retardos internos,
 * caída de salida ni corrientes de polarización.
 */

export interface AstableParams {
  /** Tensión de alimentación, en voltios. */
  vcc: number;
  /** R1 (de VCC a DIS), en ohmios. */
  r1: number;
  /** R2 (de DIS a THR/TRIG), en ohmios. */
  r2: number;
  /** C (de THR/TRIG a tierra), en faradios. */
  c: number;
}

export const DEFAULT_ASTABLE: AstableParams = { vcc: 5, r1: 1000, r2: 4700, c: 10e-6 };

/** Tiempos esperados según la ecuación del datasheet, en segundos. */
export function expectedTimes(p: AstableParams): { high: number; low: number; period: number } {
  const high = 0.693 * (p.r1 + p.r2) * p.c;
  const low = 0.693 * p.r2 * p.c;
  return { high, low, period: high + low };
}

export function astableNetlist(p: AstableParams): string {
  const { period } = expectedTimes(p);
  const tstep = period / 8000;
  const tstop = period * 4.5;
  const half = p.vcc / 2;
  const lowTh = p.vcc / 3;
  const highTh = (2 * p.vcc) / 3;
  const hyst = p.vcc / 6;

  return `NE555 astable - modelo ideal (diagrama de bloques del datasheet)
VCC vcc 0 ${p.vcc}
R1 vcc dis ${p.r1}
R2 dis thr ${p.r2}
C1 thr 0 ${p.c} IC=0
* Comparadores: set cuando THR < 1/3 VCC, reset cuando THR > 2/3 VCC
Bl cl 0 V = ${half} - V(thr)
Bh ch 0 V = V(thr) - ${half}
Sset vcc st cl 0 SWS
Srst st 0 ch 0 SWS
Cst st 0 1u IC=${p.vcc}
* Descarga: DIS a tierra mientras la salida esta en bajo
Bc ctl 0 V = ${p.vcc} - V(st)
S1 dis 0 ctl 0 SWM
.model SWS SW(RON=10 ROFF=1e9 VT=${hyst} VH=0.02)
.model SWM SW(RON=1 ROFF=1e9 VT=${half} VH=0.1)
.tran ${tstep.toPrecision(6)} ${tstop.toPrecision(6)} UIC
.end
* umbrales de referencia: ${lowTh.toFixed(3)} V y ${highTh.toFixed(3)} V`;
}
