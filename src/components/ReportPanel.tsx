import { useState, type CSSProperties } from "react";
import type { DraftReport } from "../extract/buildDraft";
import type { PageLines } from "../extract/pdfLines";
import type { Analysis } from "../model/schema";

interface Props {
  report: DraftReport;
  analysis: Analysis;
  /** Texto detectado en cada página; sirve para ver qué leyó la app y para copiarlo. */
  pagesText: PageLines[];
  /** Página que se está viendo en el visor. */
  currentPage: number;
}

const SECTION_NAME: Record<string, string> = {
  "absolute-max": "límites absolutos",
  recommended: "condiciones recomendadas",
  electrical: "características eléctricas",
  timing: "temporización",
  thermal: "térmicos",
  pins: "pines",
  other: "otros",
};

const box: CSSProperties = { border: "1px solid #ddd", borderRadius: 6, padding: 12, margin: "8px 0", background: "#fafafa" };

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function reportText(report: DraftReport, analysis: Analysis): string {
  const sections = Object.entries(report.sections)
    .map(([k, v]) => `${SECTION_NAME[k] ?? k}: ${v}`)
    .join(", ");
  return [
    `Informe de análisis de Amper`,
    `Archivo: ${analysis.datasheet.fileName} (${report.pages} páginas)`,
    `Texto leído: ${report.textChars} caracteres${report.ocr ? " (con OCR)" : ""}`,
    `Modo: ${report.mode}`,
    `Encabezados de sección reconocidos: ${sections || "ninguno"}`,
    `Encabezados de columna Min/Typ/Max: ${report.tableHeaders}`,
    `Resultado: ${analysis.pins.length} pines, ${analysis.parameters.length} parámetros, ${analysis.equations.length} ecuaciones`,
    `Líneas con valor y unidad: ${report.specLines} (${report.unmatched.length} sin interpretar)`,
    ``,
    `Avisos:`,
    ...report.hints.map((h) => `- ${h}`),
    ``,
    `Ejemplos de líneas sin interpretar:`,
    ...report.unmatched.slice(0, 20).map((l) => `  ${l}`),
  ].join("\n");
}

/** Informe de lo que hizo el análisis y por qué salió lo que salió. */
export function ReportPanel({ report, analysis, pagesText, currentPage }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(kind: string, text: string) {
    const ok = await copyText(text);
    setCopied(ok ? kind : "error");
    setTimeout(() => setCopied(null), 2500);
  }

  const pageLines = pagesText.find((p) => p.page === currentPage)?.lines ?? [];
  const allText = pagesText.map((p) => `--- página ${p.page} ---\n${p.lines.join("\n")}`).join("\n");
  const sectionList = Object.entries(report.sections)
    .map(([k, v]) => `${SECTION_NAME[k] ?? k} (${v})`)
    .join(", ");

  return (
    <div style={box}>
      <h3 style={{ margin: "0 0 6px" }}>Informe del análisis</h3>
      <p style={{ fontSize: 13, margin: "4px 0" }}>
        {report.pages} páginas · {report.textChars} caracteres de texto{report.ocr ? " (leídos con OCR)" : ""} · modo {report.mode} ·
        encabezados de sección reconocidos: {sectionList || "ninguno"}
      </p>

      {report.hints.length > 0 ? (
        <ul style={{ fontSize: 14, margin: "6px 0", paddingLeft: 20 }}>
          {report.hints.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      ) : (
        <p style={{ fontSize: 14 }}>Sin avisos: el análisis encontró datos con los encabezados habituales.</p>
      )}

      {report.unmatched.length > 0 && (
        <details style={{ margin: "6px 0" }}>
          <summary style={{ cursor: "pointer", fontSize: 14 }}>
            Líneas con valor y unidad que no pude interpretar ({report.unmatched.length})
          </summary>
          <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto", margin: "6px 0" }}>
            {report.unmatched.join("\n")}
          </pre>
        </details>
      )}

      <details style={{ margin: "6px 0" }}>
        <summary style={{ cursor: "pointer", fontSize: 14 }}>
          Texto que detecté en la página {currentPage} ({pageLines.length} líneas)
        </summary>
        <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto", margin: "6px 0" }}>
          {pageLines.length > 0 ? pageLines.join("\n") : "(sin texto en esta página)"}
        </pre>
      </details>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => copy("informe", reportText(report, analysis))}>Copiar informe</button>
        <button onClick={() => copy("texto", allText)}>Copiar todo el texto detectado</button>
        {copied === "informe" && <span style={{ fontSize: 13 }}>Informe copiado.</span>}
        {copied === "texto" && <span style={{ fontSize: 13 }}>Texto copiado.</span>}
        {copied === "error" && <span style={{ fontSize: 13, color: "#b00020" }}>No se pudo copiar.</span>}
      </div>
      <p style={{ fontSize: 12, color: "#555", margin: "6px 0 0" }}>
        El informe incluye conteos y hasta 20 líneas de ejemplo del PDF. El texto completo solo se copia si lo pides.
      </p>
    </div>
  );
}
