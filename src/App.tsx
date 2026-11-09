import { useEffect, useState, type ChangeEvent } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { APP_NAME, LIMITS } from "./config";
import { loadPdf, PdfLoadError, type LoadedPdf } from "./pdf/loadPdf";
import { PdfViewer } from "./components/PdfViewer";
import { ReviewPanel } from "./components/ReviewPanel";
import { extractPageLines, type PageLines } from "./extract/pdfLines";
import { buildDraft } from "./extract/buildDraft";
import { Simulator } from "./components/Simulator";
import type { Analysis } from "./model/schema";

export function App() {
  const maxMb = LIMITS.maxPdfBytes / (1024 * 1024);
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [component, setComponent] = useState("NE555");
  const [manufacturer, setManufacturer] = useState("Texas Instruments");
  const [extracting, setExtracting] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  // Libera el documento anterior al cargar otro, y al desmontar.
  useEffect(() => {
    const doc: PDFDocumentProxy | undefined = loaded?.doc;
    return () => {
      void doc?.destroy();
    };
  }, [loaded]);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setBusy(true);
    setError(null);
    setAnalysis(null);
    try {
      const next = await loadPdf(file);
      setLoaded(next);
      setPage(1);
    } catch (err) {
      setLoaded(null);
      setError(err instanceof PdfLoadError ? err.message : "Ocurrió un error inesperado al leer el PDF.");
    } finally {
      setBusy(false);
    }
  }

  async function runExtraction() {
    if (!loaded) return;
    const pages: PageLines[] = [];
    try {
      for (let p = 1; p <= loaded.pages; p++) {
        setExtracting(p);
        pages.push({ page: p, lines: await extractPageLines(loaded.doc, p) });
      }
      setAnalysis(
        buildDraft(pages, {
          component: component.trim() || "Componente",
          manufacturer: manufacturer.trim(),
          fileName: loaded.fileName,
          hash: loaded.hash,
          pages: loaded.pages,
        }),
      );
    } catch {
      setError("No se pudo extraer el texto de este PDF.");
    } finally {
      setExtracting(null);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16, maxWidth: 960, margin: "0 auto" }}>
      <h1>{APP_NAME}</h1>
      <p>Analiza datasheets y los convierte en circuitos simulados y animados.</p>

      <section>
        <h2>Subir datasheet</h2>
        <p>
          Límites: PDF de hasta {maxMb} MB y {LIMITS.maxPdfPages} páginas. Todo se procesa en tu navegador.
        </p>
        <input type="file" accept="application/pdf,.pdf" onChange={onFile} disabled={busy} />
        {busy && <p>Leyendo PDF…</p>}
        {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
      </section>

      {loaded && (
        <section>
          <h2>{loaded.fileName}</h2>
          <p style={{ fontSize: 13, color: "#555" }}>
            {loaded.pages} páginas · SHA-256 {loaded.hash.slice(0, 16)}…
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label>
              Componente{" "}
              <input value={component} onChange={(e) => setComponent(e.target.value)} />
            </label>
            <label>
              Fabricante{" "}
              <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
            </label>
            <button onClick={runExtraction} disabled={extracting !== null}>
              {extracting !== null ? `Extrayendo página ${extracting} de ${loaded.pages}…` : "Extraer borrador"}
            </button>
          </div>

          <PdfViewer doc={loaded.doc} page={page} onPageChange={setPage} />
        </section>
      )}

      <section>
        <h2>Simulador</h2>
        <Simulator />
      </section>

      {analysis && (
        <section>
          <h2>
            Revisión: {analysis.component} ({analysis.manufacturer})
          </h2>
          <ReviewPanel
            analysis={analysis}
            onChange={setAnalysis}
            onShowPage={(p) => {
              setPage(p);
              document.getElementById("visor")?.scrollIntoView({ behavior: "smooth" });
            }}
          />
        </section>
      )}
    </main>
  );
}
