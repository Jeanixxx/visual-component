import type { CSSProperties } from "react";
import type { Analysis, Equation, ParamSection, Parameter, Pin } from "../model/schema";

interface Props {
  analysis: Analysis;
  onChange: (next: Analysis) => void;
  /** Sin PDF cargado (análisis abierto desde la biblioteca) no hay visor: las páginas son solo texto. */
  onShowPage?: (page: number) => void;
}

const SECTION_LABEL: Record<ParamSection, string> = {
  "absolute-max": "Valores absolutos máximos",
  recommended: "Condiciones recomendadas",
  electrical: "Características eléctricas",
  other: "Otros",
};

function patchAt<T>(list: T[], index: number, patch: Partial<T>): T[] {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

function toNum(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isNaN(n) ? null : n;
}

const cell: CSSProperties = { padding: "4px 6px", fontSize: 14, width: "100%", boxSizing: "border-box" };
const th: CSSProperties = { textAlign: "left", fontSize: 12, color: "#555", padding: "4px 6px", fontWeight: 600 };
const td: CSSProperties = { padding: 4, verticalAlign: "top" };

/** Panel de revisión: cada fila es un borrador hasta que el usuario la marca como revisada. */
export function ReviewPanel({ analysis, onChange, onShowPage }: Props) {
  const total = analysis.pins.length + analysis.parameters.length + analysis.equations.length;
  const reviewed = [...analysis.pins, ...analysis.parameters, ...analysis.equations].filter((x) => x.reviewed).length;

  const touch = (next: Partial<Analysis>) =>
    onChange({ ...analysis, ...next, updatedAt: new Date().toISOString() });

  const pageButton = (page: number) =>
    onShowPage ? (
      <button onClick={() => onShowPage(page)} style={{ fontSize: 12 }}>
        pág. {page}
      </button>
    ) : (
      <span style={{ fontSize: 12 }}>pág. {page}</span>
    );

  const reviewBox = (checked: boolean, onToggle: (v: boolean) => void) => (
    <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} aria-label="revisado" />
  );

  const sections: ParamSection[] = ["absolute-max", "recommended", "electrical", "other"];

  return (
    <section style={{ overflowX: "auto" }}>
      <p style={{ fontSize: 14 }}>
        <strong>
          {reviewed} de {total}
        </strong>{" "}
        datos revisados. Son borradores: compara cada fila con la página antes de marcarla.
      </p>

      <h3>Pines ({analysis.pins.length})</h3>
      <table style={{ minWidth: 600, width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>N°</th>
            <th style={th}>Nombre</th>
            <th style={th}>Función</th>
            <th style={th}>Pág.</th>
            <th style={th}>OK</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {analysis.pins.map((p: Pin, i) => (
            <tr key={i}>
              <td style={td}>
                <input style={cell} type="number" value={p.number}
                  onChange={(e) => touch({ pins: patchAt(analysis.pins, i, { number: Number(e.target.value) }) })} />
              </td>
              <td style={td}>
                <input style={cell} value={p.name}
                  onChange={(e) => touch({ pins: patchAt(analysis.pins, i, { name: e.target.value }) })} />
              </td>
              <td style={td}>
                <input style={cell} value={p.role}
                  onChange={(e) => touch({ pins: patchAt(analysis.pins, i, { role: e.target.value }) })} />
              </td>
              <td style={td}>{pageButton(p.page)}</td>
              <td style={td}>{reviewBox(p.reviewed, (v) => touch({ pins: patchAt(analysis.pins, i, { reviewed: v }) }))}</td>
              <td style={td}>
                <button onClick={() => touch({ pins: removeAt(analysis.pins, i) })} aria-label="eliminar">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {sections.map((sec) => {
        const rows = analysis.parameters
          .map((p, index) => ({ p, index }))
          .filter(({ p }) => p.section === sec);
        if (rows.length === 0) return null;
        return (
          <div key={sec}>
            <h3>{SECTION_LABEL[sec]} ({rows.length})</h3>
            <table style={{ minWidth: 720, width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Símbolo</th>
                  <th style={th}>Nombre</th>
                  <th style={th}>Mín</th>
                  <th style={th}>Típ</th>
                  <th style={th}>Máx</th>
                  <th style={th}>Unidad</th>
                  <th style={th}>Condiciones / nota</th>
                  <th style={th}>Pág.</th>
                  <th style={th}>OK</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, index }) => {
                  const set = (patch: Partial<Parameter>) =>
                    touch({ parameters: patchAt(analysis.parameters, index, patch) });
                  return (
                    <tr key={index}>
                      <td style={td}><input style={cell} value={p.symbol} onChange={(e) => set({ symbol: e.target.value })} /></td>
                      <td style={td}><input style={cell} value={p.name} onChange={(e) => set({ name: e.target.value })} /></td>
                      <td style={td}><input style={cell} value={p.min ?? ""} onChange={(e) => set({ min: toNum(e.target.value) })} /></td>
                      <td style={td}><input style={cell} value={p.typ ?? ""} onChange={(e) => set({ typ: toNum(e.target.value) })} /></td>
                      <td style={td}><input style={cell} value={p.max ?? ""} onChange={(e) => set({ max: toNum(e.target.value) })} /></td>
                      <td style={td}><input style={cell} value={p.unit} onChange={(e) => set({ unit: e.target.value })} /></td>
                      <td style={td}><input style={cell} value={p.conditions} placeholder="condiciones o nota" onChange={(e) => set({ conditions: e.target.value })} /></td>
                      <td style={td}>{pageButton(p.page)}</td>
                      <td style={td}>{reviewBox(p.reviewed, (v) => set({ reviewed: v }))}</td>
                      <td style={td}>
                        <button onClick={() => touch({ parameters: removeAt(analysis.parameters, index) })} aria-label="eliminar">×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      <h3>Ecuaciones ({analysis.equations.length})</h3>
      <table style={{ minWidth: 480, width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Nombre</th>
            <th style={th}>Expresión</th>
            <th style={th}>Pág.</th>
            <th style={th}>OK</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {analysis.equations.map((eq: Equation, i) => (
            <tr key={i}>
              <td style={td}>
                <input style={cell} value={eq.name}
                  onChange={(e) => touch({ equations: patchAt(analysis.equations, i, { name: e.target.value }) })} />
              </td>
              <td style={td}>
                <input style={cell} value={eq.expr}
                  onChange={(e) => touch({ equations: patchAt(analysis.equations, i, { expr: e.target.value }) })} />
              </td>
              <td style={td}>{pageButton(eq.page)}</td>
              <td style={td}>{reviewBox(eq.reviewed, (v) => touch({ equations: patchAt(analysis.equations, i, { reviewed: v }) }))}</td>
              <td style={td}>
                <button onClick={() => touch({ equations: removeAt(analysis.equations, i) })} aria-label="eliminar">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
