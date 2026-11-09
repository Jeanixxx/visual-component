import { useEffect, useState, type ChangeEvent } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { APP_NAME, LIMITS } from "./config";
import { loadPdf, PdfLoadError, type LoadedPdf } from "./pdf/loadPdf";
import { PdfViewer } from "./components/PdfViewer";
import { ReviewPanel } from "./components/ReviewPanel";
import { extractPageLines, type PageLines } from "./extract/pdfLines";
import { looksScanned, ocrPdf, OCR_MAX_PAGES } from "./ocr/ocr";
import { buildDraftWithReport, type DraftReport } from "./extract/buildDraft";
import { ReportPanel } from "./components/ReportPanel";
import { Simulator } from "./components/Simulator";
import { LibraryPanel } from "./components/LibraryPanel";
import { listSaved, removeSaved, saveStarred, LibraryError } from "./storage/library";
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
  const [note, setNote] = useState<string | null>(null);
  const [report, setReport] = useState<DraftReport | null>(null);
  const [pagesText, setPagesText] = useState<PageLines[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [library, setLibrary] = useState<Analysis[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  // Libera el documento anterior al cargar otro, y al desmontar.
  useEffect(() => {
    const doc: PDFDocumentProxy | undefined = loaded?.doc;
    return () => {
      void doc?.destroy();
    };
  }, [loaded]);

  // Carga la biblioteca guardada al abrir la app.
  useEffect(() => {
    refreshLibrary();
  }, []);

  // Si el análisis abierto tiene estrella, cada cambio de revisión se guarda.
  useEffect(() => {
    if (!analysis?.starred) return;
    saveStarred(analysis).then(refreshLibrary).catch(reportLibraryError);
  }, [analysis]);

  function reportLibraryError(err: unknown) {
    setLibraryError(err instanceof LibraryError ? err.message : "No se pudo usar el almacenamiento local.");
  }

  async function refreshLibrary() {
    try {
      setLibrary(await listSaved());
      setLibraryError(null);
    } catch (err) {
      reportLibraryError(err);
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setBusy(true);
    setError(null);
    setAnalysis(null);
    setReport(null);
    setPagesText([]);
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
    let pages: PageLines[] = [];
    let usedOcr = false;
    setNote(null);
    setError(null);
    try {
      for (let p = 1; p <= loaded.pages; p++) {
        setExtracting(p);
        pages.push(await extractPageLines(loaded.doc, p));
      }
      // Un PDF escaneado no tiene texto seleccionable: se lee con OCR local.
      if (looksScanned(pages)) {
        setNote("Este PDF no tiene texto seleccionable. Aplicando OCR local; puede tardar unos segundos por página…");
        const ocr = await ocrPdf(loaded.doc, ({ page: p, total }) =>
          setNote(`OCR local: página ${p} de ${total}…`),
        );
        pages = ocr.pages;
        usedOcr = true;
        setNote(
          ocr.truncated
            ? `El texto se obtuvo con OCR, solo de las primeras ${OCR_MAX_PAGES} páginas. Revisa los valores con cuidado.`
            : "El texto se obtuvo con OCR. Revisa los valores con cuidado: el OCR puede confundir caracteres.",
        );
      }
      const result = buildDraftWithReport(pages, {
        component: component.trim() || "Componente",
        manufacturer: manufacturer.trim(),
        fileName: loaded.fileName,
        hash: loaded.hash,
        pages: loaded.pages,
        ocr: usedOcr,
      });
      const draft = result.analysis;
      setAnalysis(draft);
      setReport(result.report);
      setPagesText(pages);
      if (draft.pins.length === 0 && draft.parameters.length === 0) {
        setError(
          "No encontré pines ni parámetros en este PDF. Puede no ser una hoja de datos de componente, o su texto no es seleccionable.",
        );
      }
    } catch {
      setError("No se pudo extraer el texto de este PDF.");
    } finally {
      setExtracting(null);
    }
  }

  /** Marca o desmarca el análisis actual. Con estrella se guarda en la biblioteca. */
  async function toggleStar() {
    if (!analysis) return;
    if (analysis.starred) {
      setAnalysis({ ...analysis, starred: false });
      try {
        await removeSaved(analysis.id);
        await refreshLibrary();
      } catch (err) {
        reportLibraryError(err);
      }
    } else {
      const next = { ...analysis, starred: true, updatedAt: new Date().toISOString() };
      setAnalysis(next);
      try {
        await saveStarred(next);
        await refreshLibrary();
      } catch (err) {
        reportLibraryError(err);
      }
    }
  }

  async function removeFromLibrary(id: string) {
    try {
      await removeSaved(id);
      if (analysis?.id === id) setAnalysis({ ...analysis, starred: false });
      await refreshLibrary();
    } catch (err) {
      reportLibraryError(err);
    }
  }

  async function importToLibrary(list: Analysis[]) {
    try {
      for (const a of list) await saveStarred(a);
      await refreshLibrary();
    } catch (err) {
      reportLibraryError(err);
      throw err;
    }
  }

  function openFromLibrary(a: Analysis) {
    setLoaded(null);
    setError(null);
    setAnalysis(a);
    document.getElementById("revision")?.scrollIntoView({ behavior: "smooth" });
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
              {extracting !== null ? "Analizando…" : "Extraer borrador"}
            </button>
          </div>

          {note && <p role="status" style={{ fontSize: 13, color: "#555" }}>{note}</p>}

          <PdfViewer doc={loaded.doc} page={page} onPageChange={setPage} />
        </section>
      )}

      {analysis && (
        <section id="revision">
          <h2>
            Revisión: {analysis.component} ({analysis.manufacturer})
          </h2>
          <button onClick={toggleStar} style={{ marginBottom: 8 }}>
            {analysis.starred ? "★ Quitar de la biblioteca" : "☆ Guardar con estrella"}
          </button>
          {report && <ReportPanel report={report} analysis={analysis} pagesText={pagesText} currentPage={page} />}
          <ReviewPanel
            analysis={analysis}
            currentPage={page}
            onChange={setAnalysis}
            onShowPage={
              loaded
                ? (p) => {
                    setPage(p);
                    document.getElementById("visor")?.scrollIntoView({ behavior: "smooth" });
                  }
                : undefined
            }
          />
        </section>
      )}

      <section>
        <h2>Simulador</h2>
        <Simulator />
      </section>

      <LibraryPanel
        items={library}
        error={libraryError}
        onOpen={openFromLibrary}
        onRemove={removeFromLibrary}
        onImport={importToLibrary}
      />
    </main>
  );
}
