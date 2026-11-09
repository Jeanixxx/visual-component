import { useEffect, useRef, useState } from "react";
import { sampleIndex, type FlowData } from "../sim/flow";

interface Props {
  flow: FlowData;
  vcc: number;
}

type Pt = [number, number];

/** Trazados del circuito en el SVG (viewBox 360 x 280). */
const PATH = {
  r1: [[120, 30], [120, 100]] as Pt[],
  r2: [[120, 100], [120, 165]] as Pt[],
  c: [[120, 165], [120, 232]] as Pt[],
  s1: [[120, 100], [230, 100], [230, 240]] as Pt[],
};

const DOTS_PER_BRANCH = 6;
const SPEEDS = [
  { label: "lento", msPerSec: 20 },
  { label: "medio", msPerSec: 50 },
  { label: "rápido", msPerSec: 120 },
];

/** Punto a una fracción f (0..1) de la longitud total de un trazado. */
function pointAt(path: Pt[], f: number): Pt {
  let total = 0;
  const lens: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const d = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    lens.push(d);
    total += d;
  }
  let dist = f * total;
  for (let i = 1; i < path.length; i++) {
    const d = lens[i - 1];
    if (dist <= d) {
      const u = d === 0 ? 0 : dist / d;
      return [
        path[i - 1][0] + u * (path[i][0] - path[i - 1][0]),
        path[i - 1][1] + u * (path[i][1] - path[i - 1][1]),
      ];
    }
    dist -= d;
  }
  return path[path.length - 1];
}

/** Puntos que fluyen sobre un trazado. Su posición depende de la carga acumulada: si la corriente es negativa, retroceden. */
function dots(path: Pt[], charge: number, qUnit: number): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < DOTS_PER_BRANCH; k++) {
    const phase = charge / qUnit + k / DOTS_PER_BRANCH;
    const f = ((phase % 1) + 1) % 1;
    out.push(pointAt(path, f));
  }
  return out;
}

/** Color del nodo según su voltaje: azul en 0 V, rojo en VCC. */
function voltageColor(v: number, vcc: number): string {
  const u = Math.max(0, Math.min(1, v / vcc));
  const r = Math.round(21 + u * (198 - 21));
  const g = Math.round(101 + u * (40 - 101));
  const b = Math.round(192 + u * (40 - 192));
  return `rgb(${r},${g},${b})`;
}

const mA = (i: number) => `${(i * 1e3).toFixed(2)} mA`;

export function FlowAnimation({ flow, vcc }: Props) {
  const tEnd = flow.t[flow.t.length - 1];
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  // La referencia lleva el tiempo real del bucle; el estado solo se usa para dibujar.
  const timeRef = useRef(0);
  const lastRef = useRef<number | null>(null);

  function seek(next: number) {
    timeRef.current = next;
    setTime(next);
  }

  // Reproducción en tiempo real a velocidad elegida (ms de simulación por segundo real).
  useEffect(() => {
    if (!playing) {
      lastRef.current = null;
      return;
    }
    let raf = 0;
    const msPerSec = SPEEDS[speedIdx].msPerSec;
    const tick = (now: number) => {
      const last = lastRef.current ?? now;
      lastRef.current = now;
      const dt = (now - last) / 1000;
      const next = timeRef.current + dt * (msPerSec / 1000);
      if (next >= tEnd) {
        seek(tEnd);
        setPlaying(false);
        return;
      }
      seek(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speedIdx, tEnd]);

  const k = sampleIndex(flow.t, time);
  const vThr = flow.vThr[k];
  const vDis = flow.vDis[k];
  const vOut = flow.vOut[k];
  const outHigh = vOut > vcc / 2;

  const pointsR1 = dots(PATH.r1, flow.qR1[k], flow.qUnit);
  const pointsR2 = dots(PATH.r2, flow.qR2[k], flow.qUnit);
  const pointsC = dots(PATH.c, flow.qC[k], flow.qUnit);
  const pointsS = dots(PATH.s1, flow.qS[k], flow.qUnit);

  const pathD = (p: Pt[]) => p.map((pt, i) => `${i === 0 ? "M" : "L"}${pt[0]},${pt[1]}`).join(" ");

  return (
    <div style={{ marginTop: 16 }}>
      <h4 style={{ margin: "8px 0" }}>Flujo de corriente animado</h4>
      <p style={{ fontSize: 13, color: "#555", margin: "0 0 8px" }}>
        Los puntos avanzan según la corriente simulada: más corriente, más rápido. Azul = corriente que sale de VCC.
      </p>

      <svg viewBox="0 0 360 280" style={{ width: "100%", maxWidth: 360, height: "auto" }} role="img"
        aria-label="Circuito astable con puntos que muestran el flujo de corriente">
        {/* Cables */}
        <path d={pathD(PATH.r1)} stroke="#777" strokeWidth="2" fill="none" />
        <path d={pathD(PATH.r2)} stroke="#777" strokeWidth="2" fill="none" />
        <path d={pathD(PATH.c)} stroke="#777" strokeWidth="2" fill="none" />
        <path d={pathD(PATH.s1)} stroke="#777" strokeWidth="2" fill="none" />
        <line x1="100" y1="240" x2="230" y2="240" stroke="#777" strokeWidth="2" />

        {/* Componentes */}
        <rect x="108" y="48" width="24" height="30" fill="#fff" stroke="#333" />
        <text x="138" y="66" fontSize="12" fill="#333">R1</text>
        <rect x="108" y="116" width="24" height="30" fill="#fff" stroke="#333" />
        <text x="138" y="134" fontSize="12" fill="#333">R2</text>
        <line x1="100" y1="190" x2="140" y2="190" stroke="#333" strokeWidth="2" />
        <line x1="100" y1="198" x2="140" y2="198" stroke="#333" strokeWidth="2" />
        <text x="146" y="197" fontSize="12" fill="#333">C</text>
        <rect x="186" y="92" width="34" height="16" fill="#fff" stroke="#333" />
        <text x="190" y="84" fontSize="11" fill="#333">S1 (descarga)</text>

        {/* Nodos */}
        <circle cx="120" cy="100" r="4" fill={voltageColor(vDis, vcc)} />
        <text x="126" y="96" fontSize="11" fill="#333">DIS {vDis.toFixed(2)} V</text>
        <circle cx="120" cy="165" r="4" fill={voltageColor(vThr, vcc)} />
        <text x="126" y="170" fontSize="11" fill="#333">THR {vThr.toFixed(2)} V</text>
        <text x="126" y="24" fontSize="11" fill="#333">VCC {vcc} V</text>
        <text x="100" y="262" fontSize="11" fill="#333">GND</text>

        {/* Salida */}
        <circle cx="300" cy="60" r="10" fill={outHigh ? "#e53935" : "#90a4ae"} />
        <text x="270" y="30" fontSize="11" fill="#333">salida</text>
        <text x="262" y="82" fontSize="11" fill="#333">{outHigh ? "ALTO" : "BAJO"} {vOut.toFixed(2)} V</text>

        {/* Puntos de corriente */}
        {pointsR1.map(([x, y], i) => <circle key={`r1-${i}`} cx={x} cy={y} r="3.5" fill="#1565c0" />)}
        {pointsR2.map(([x, y], i) => <circle key={`r2-${i}`} cx={x} cy={y} r="3.5" fill="#1565c0" />)}
        {pointsC.map(([x, y], i) => <circle key={`c-${i}`} cx={x} cy={y} r="3.5" fill="#e07b00" />)}
        {pointsS.map(([x, y], i) => <circle key={`s-${i}`} cx={x} cy={y} r="3.5" fill="#c62828" />)}
      </svg>

      <table style={{ fontSize: 13, borderCollapse: "collapse", margin: "8px 0" }}>
        <tbody>
          <tr><td style={{ padding: "2px 8px", color: "#1565c0" }}>I R1 (VCC→DIS)</td><td>{mA(flow.iR1[k])}</td></tr>
          <tr><td style={{ padding: "2px 8px", color: "#1565c0" }}>I R2 (DIS→THR)</td><td>{mA(flow.iR2[k])}</td></tr>
          <tr><td style={{ padding: "2px 8px", color: "#c62828" }}>I S1 (DIS→GND)</td><td>{mA(flow.iS[k])}</td></tr>
          <tr><td style={{ padding: "2px 8px", color: "#e07b00" }}>I C (carga/descarga)</td><td>{mA(flow.iC[k])}</td></tr>
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => { if (timeRef.current >= tEnd) seek(0); setPlaying((p) => !p); }}>
          {playing ? "Pausa" : "Reproducir"}
        </button>
        <label>
          Velocidad{" "}
          <select value={speedIdx} onChange={(e) => setSpeedIdx(Number(e.target.value))}>
            {SPEEDS.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 13 }}>t = {(time * 1e3).toFixed(1)} ms</span>
      </div>
      <input
        type="range"
        min={0}
        max={tEnd}
        step={tEnd / 2000}
        value={time}
        onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }}
        style={{ width: "100%" }}
        aria-label="Tiempo de la simulación"
      />
    </div>
  );
}
