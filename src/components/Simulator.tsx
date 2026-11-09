import { useState, type CSSProperties } from "react";
import { DEFAULT_ASTABLE, astableNetlist, expectedTimes, type AstableParams } from "../sim/ne555";
import { runNetlist } from "../sim/runSim";
import { measureAstable, readWaveform, relativeError, type AstableMeasure } from "../sim/measure";
import { buildFlow, type FlowData } from "../sim/flow";
import { FlowAnimation } from "./FlowAnimation";

const TOLERANCE_PCT = 5;

const field: CSSProperties = { width: 90, padding: "4px 6px", fontSize: 14 };

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Gráfica SVG de la salida (azul) y del condensador (naranja), primeros tramos. */
function Plot({ measure, vcc }: { measure: AstableMeasure; vcc: number }) {
  const { t, out, thr } = measure.waveform;
  const W = 640;
  const H = 220;
  const pad = 28;
  const tEnd = t[t.length - 1];
  const x = (v: number) => pad + (v / tEnd) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / vcc) * (H - pad * 2);

  // Submuestreo: como máximo ~1500 puntos por trazo.
  const step = Math.max(1, Math.floor(t.length / 1500));
  const line = (series: number[]) =>
    t
      .map((tv, i) => (i % step === 0 ? `${x(tv).toFixed(1)},${y(series[i]).toFixed(1)}` : null))
      .filter(Boolean)
      .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, height: "auto" }} role="img"
      aria-label="Gráfica de la salida y del condensador en el tiempo">
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#999" />
      <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="#999" />
      <text x={pad} y={pad - 8} fontSize="12" fill="#555">{vcc} V</text>
      <text x={pad - 6} y={H - pad + 14} fontSize="12" fill="#555">0</text>
      <text x={W - pad - 60} y={H - 6} fontSize="12" fill="#555">{(tEnd * 1000).toFixed(0)} ms</text>
      <polyline points={line(thr)} fill="none" stroke="#e07b00" strokeWidth="1.5" />
      <polyline points={line(out)} fill="none" stroke="#1565c0" strokeWidth="2" />
      <text x={W - 150} y={pad} fontSize="12" fill="#1565c0">salida</text>
      <text x={W - 150} y={pad + 14} fontSize="12" fill="#e07b00">condensador</text>
    </svg>
  );
}

export function Simulator() {
  const [params, setParams] = useState<{ vcc: string; r1: string; r2: string; cUf: string }>({
    vcc: String(DEFAULT_ASTABLE.vcc),
    r1: String(DEFAULT_ASTABLE.r1),
    r2: String(DEFAULT_ASTABLE.r2),
    cUf: String(DEFAULT_ASTABLE.c * 1e6),
  });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ measure: AstableMeasure; flow: FlowData; p: AstableParams } | null>(null);

  function toParams(): AstableParams | null {
    const vcc = Number(params.vcc);
    const r1 = Number(params.r1);
    const r2 = Number(params.r2);
    const c = Number(params.cUf) * 1e-6;
    if (![vcc, r1, r2, c].every((v) => Number.isFinite(v) && v > 0)) return null;
    return { vcc, r1, r2, c };
  }

  async function simulate() {
    const p = toParams();
    if (!p) {
      setError("Todos los valores deben ser números positivos.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const res = await runNetlist(astableNetlist(p));
      setResult({
        measure: measureAstable(readWaveform(res)),
        flow: buildFlow(res, p.r1, p.r2),
        p,
      });
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "La simulación falló.");
    } finally {
      setRunning(false);
    }
  }

  const expected = toParams() ? expectedTimes(toParams()!) : null;
  const highAvg = result ? mean(result.measure.highs.slice(1)) : null;
  const lowAvg = result ? mean(result.measure.lows.slice(1)) : null;
  const errHigh = result && highAvg !== null && expected ? relativeError(highAvg, expected.high) : null;
  const errLow = result && lowAvg !== null && expected ? relativeError(lowAvg, expected.low) : null;
  const ok = errHigh !== null && errLow !== null && Math.abs(errHigh) <= TOLERANCE_PCT && Math.abs(errLow) <= TOLERANCE_PCT;

  return (
    <section>
      <h3>Simulación astable (NE555)</h3>
      <p style={{ fontSize: 13, color: "#555" }}>
        Modelo <strong>ideal</strong> basado en el diagrama de bloques del datasheet. No es el modelo del fabricante:
        ignora tolerancias, retardos internos y la caída de tensión en la salida.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label>VCC (V) <input style={field} value={params.vcc} onChange={(e) => setParams({ ...params, vcc: e.target.value })} /></label>
        <label>R1 (Ω) <input style={field} value={params.r1} onChange={(e) => setParams({ ...params, r1: e.target.value })} /></label>
        <label>R2 (Ω) <input style={field} value={params.r2} onChange={(e) => setParams({ ...params, r2: e.target.value })} /></label>
        <label>C (µF) <input style={field} value={params.cUf} onChange={(e) => setParams({ ...params, cUf: e.target.value })} /></label>
        <button onClick={simulate} disabled={running}>{running ? "Simulando…" : "Simular"}</button>
      </div>

      {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}

      {result && expected && (
        <div style={{ marginTop: 12 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "4px 8px" }}>Tiempo</th>
                <th style={{ textAlign: "left", padding: "4px 8px" }}>Medido</th>
                <th style={{ textAlign: "left", padding: "4px 8px" }}>Datasheet</th>
                <th style={{ textAlign: "left", padding: "4px 8px" }}>Error</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: "4px 8px" }}>Alto (0.693·(R1+R2)·C)</td>
                <td style={{ padding: "4px 8px" }}>{highAvg !== null ? `${(highAvg * 1e3).toFixed(2)} ms` : "—"}</td>
                <td style={{ padding: "4px 8px" }}>{(expected.high * 1e3).toFixed(2)} ms</td>
                <td style={{ padding: "4px 8px" }}>{errHigh !== null ? `${errHigh.toFixed(2)} %` : "—"}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 8px" }}>Bajo (0.693·R2·C)</td>
                <td style={{ padding: "4px 8px" }}>{lowAvg !== null ? `${(lowAvg * 1e3).toFixed(2)} ms` : "—"}</td>
                <td style={{ padding: "4px 8px" }}>{(expected.low * 1e3).toFixed(2)} ms</td>
                <td style={{ padding: "4px 8px" }}>{errLow !== null ? `${errLow.toFixed(2)} %` : "—"}</td>
              </tr>
            </tbody>
          </table>
          <p style={{ fontSize: 14, color: ok ? "#1b5e20" : "#b00020" }}>
            {ok
              ? `Dentro de ±${TOLERANCE_PCT} % de la ecuación del datasheet.`
              : `Fuera de ±${TOLERANCE_PCT} % de la ecuación del datasheet.`}{" "}
            El primer intervalo alto se excluye: parte de un condensador descargado.
          </p>
          <Plot measure={result.measure} vcc={result.p.vcc} />
          <FlowAnimation flow={result.flow} vcc={result.p.vcc} />
        </div>
      )}
    </section>
  );
}
