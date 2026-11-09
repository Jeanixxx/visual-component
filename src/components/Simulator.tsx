import { useMemo, useState, type CSSProperties } from "react";
import { TEMPLATES, templateById, type Measure, type SimTemplate } from "../sim/templates";
import { runNetlist } from "../sim/runSim";
import { buildFlow, type FlowData } from "../sim/flow";
import type { ResultType } from "eecircuit-engine";
import { FlowAnimation } from "./FlowAnimation";

const TOLERANCE_DEFAULT = 5;
const field: CSSProperties = { width: 96, padding: "4px 6px", fontSize: 14 };
const COLORS = ["#1565c0", "#e07b00", "#2e7d32", "#8e24aa", "#c62828", "#00838f"];

interface Trace {
  name: string;
  values: number[];
}

/** Gráfica genérica de una o varias señales frente al tiempo. */
function Plot({ t, traces }: { t: number[]; traces: Trace[] }) {
  if (t.length === 0 || traces.length === 0) return null;
  const W = 640;
  const H = 240;
  const pad = 36;
  const tEnd = t[t.length - 1] || 1;
  let lo = Infinity;
  let hi = -Infinity;
  for (const tr of traces) for (const v of tr.values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo) || lo === hi) { lo -= 1; hi += 1; }
  const x = (v: number) => pad + (v / tEnd) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2);
  const step = Math.max(1, Math.floor(t.length / 1500));
  const line = (vals: number[]) =>
    t.map((tv, i) => (i % step === 0 ? `${x(tv).toFixed(1)},${y(vals[i]).toFixed(1)}` : null)).filter(Boolean).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, height: "auto" }} role="img"
      aria-label="Gráfica de las señales de la simulación">
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#999" />
      <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="#999" />
      <text x={pad - 4} y={pad + 4} fontSize="11" fill="#555" textAnchor="end">{hi.toPrecision(3)}</text>
      <text x={pad - 4} y={H - pad} fontSize="11" fill="#555" textAnchor="end">{lo.toPrecision(3)}</text>
      <text x={W - pad - 70} y={H - 8} fontSize="11" fill="#555">{(tEnd * 1e3).toPrecision(3)} ms</text>
      {traces.map((tr, i) => (
        <polyline key={tr.name} points={line(tr.values)} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="1.6" />
      ))}
      {traces.map((tr, i) => (
        <text key={`l-${tr.name}`} x={pad + 8} y={pad + 14 + i * 14} fontSize="12" fill={COLORS[i % COLORS.length]}>{tr.name}</text>
      ))}
    </svg>
  );
}

function MeasureTable({ rows }: { rows: Measure[] }) {
  return (
    <table style={{ borderCollapse: "collapse", fontSize: 14, marginTop: 8 }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", padding: "4px 8px" }}>Medida</th>
          <th style={{ textAlign: "left", padding: "4px 8px" }}>Simulado</th>
          <th style={{ textAlign: "left", padding: "4px 8px" }}>Referencia</th>
          <th style={{ textAlign: "left", padding: "4px 8px" }}>Error</th>
          <th style={{ textAlign: "left", padding: "4px 8px" }}>Estado</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const ok = m.errorPct !== null && Math.abs(m.errorPct) <= m.tolerancePct;
          const fmt = (v: number | null) => (v === null ? "—" : `${(v * (m.unit === "s" ? 1e3 : 1)).toPrecision(4)} ${m.unit === "s" ? "ms" : m.unit}`);
          return (
            <tr key={m.label}>
              <td style={{ padding: "4px 8px" }}>
                {m.label}
                {m.note && <div style={{ fontSize: 12, color: "#555" }}>{m.note}</div>}
              </td>
              <td style={{ padding: "4px 8px" }}>{fmt(m.measured)}</td>
              <td style={{ padding: "4px 8px" }}>{fmt(m.expected)}</td>
              <td style={{ padding: "4px 8px" }}>{m.errorPct !== null ? `${m.errorPct.toFixed(2)} %` : "—"}</td>
              <td style={{ padding: "4px 8px", color: ok ? "#1b5e20" : "#b00020" }}>
                {m.errorPct === null ? "sin medida" : ok ? `dentro de ±${m.tolerancePct} %` : `fuera de ±${m.tolerancePct} %`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Simulator() {
  const [templateId, setTemplateId] = useState("ne555-astable");
  const template: SimTemplate = templateById(templateId);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(template.params.map((p) => [p.key, String(p.default)])),
  );
  const [customNetlist, setCustomNetlist] = useState("RC de ejemplo\nV1 in 0 PULSE(0 1 0 1u 1u 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m\n.end");
  const [customSignals, setCustomSignals] = useState("v(out)");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    res: ResultType;
    measures: Measure[];
    flow: FlowData | null;
    signals: string[];
  } | null>(null);

  function pickTemplate(id: string) {
    const t = templateById(id);
    setTemplateId(id);
    setValues(Object.fromEntries(t.params.map((p) => [p.key, String(p.default)])));
    setResult(null);
    setError(null);
  }

  function numericValues(): Record<string, number> | null {
    const out: Record<string, number> = {};
    for (const p of template.params) {
      const raw = values[p.key] ?? "";
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return null;
      out[p.key] = n;
    }
    return out;
  }

  async function simulate() {
    setError(null);
    let netlist: string;
    let signals: string[];
    let vals: Record<string, number> = {};

    if (template.id === "custom") {
      netlist = customNetlist;
      signals = customSignals.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      const v = numericValues();
      if (!v) {
        setError("Todos los valores deben ser números positivos.");
        return;
      }
      vals = v;
      netlist = template.netlist(v);
      signals = template.signals;
    }

    setRunning(true);
    try {
      const res = await runNetlist(netlist);
      const measures = template.id === "custom" ? [] : template.measure(res, vals);
      const flow = template.id === "ne555-astable"
        ? buildFlow(res, vals.r1, vals.r2)
        : null;
      setResult({ res, measures, flow, signals });
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "La simulación falló.");
    } finally {
      setRunning(false);
    }
  }

  const traces: { t: number[]; list: Trace[] } | null = useMemo(() => {
    if (!result) return null;
    try {
      const timeSeries = result.res.data.find((d) => d.name === "time");
      if (!timeSeries) return null;
      const t = timeSeries.values as number[];
      const list: Trace[] = [];
      for (const name of result.signals) {
        const s = result.res.data.find((d) => d.name === name);
        if (s) list.push({ name, values: s.values as number[] });
      }
      return { t, list };
    } catch {
      return null;
    }
  }, [result]);

  const tolerance = TOLERANCE_DEFAULT;

  return (
    <section>
      <h3>Simulador</h3>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label>
          Circuito{" "}
          <select value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
            {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </label>
      </div>
      <p style={{ fontSize: 13, color: "#555" }}>
        <strong>Referencia:</strong> {template.reference}
        <br />
        {template.disclaimer}
      </p>

      {template.id === "custom" ? (
        <div style={{ display: "grid", gap: 8 }}>
          <textarea value={customNetlist} onChange={(e) => setCustomNetlist(e.target.value)} rows={8}
            style={{ fontFamily: "monospace", fontSize: 13, width: "100%", boxSizing: "border-box" }}
            aria-label="Netlist SPICE" />
          <label>
            Señales a graficar (separadas por coma){" "}
            <input value={customSignals} onChange={(e) => setCustomSignals(e.target.value)} style={{ width: 220 }} />
          </label>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {template.params.map((p) => (
            <label key={p.key}>
              {p.label} ({p.unit}){" "}
              <input style={field} value={values[p.key] ?? ""}
                onChange={(e) => setValues({ ...values, [p.key]: e.target.value })} />
            </label>
          ))}
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <button onClick={simulate} disabled={running}>{running ? "Simulando…" : "Simular"}</button>
      </div>

      {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}

      {result && (
        <div style={{ marginTop: 12 }}>
          {result.measures.length > 0 && (
            <>
              <MeasureTable rows={result.measures} />
              <p style={{ fontSize: 14, margin: "6px 0" }}>
                {result.measures.every((m) => m.errorPct !== null && Math.abs(m.errorPct) <= m.tolerancePct)
                  ? `Todas las medidas dentro de su tolerancia.`
                  : `Alguna medida está fuera de su tolerancia (±${tolerance} % por defecto).`}
              </p>
            </>
          )}
          {traces && <Plot t={traces.t} traces={traces.list} />}
          {result.flow && <FlowAnimation flow={result.flow} vcc={Number(values.vcc)} />}
        </div>
      )}
    </section>
  );
}
