import { useEffect, useState, type ChangeEvent } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { APP_NAME, LIMITS } from "./config";
import { loadPdf, PdfLoadError, type LoadedPdf } from "./pdf/loadPdf";
import { PdfViewer } from "./components/PdfViewer";

export function App() {
  const maxMb = LIMITS.maxPdfBytes / (1024 * 1024);
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    try {
      setLoaded(await loadPdf(file));
    } catch (err) {
      setLoaded(null);
      setError(err instanceof PdfLoadError ? err.message : "Ocurrió un error inesperado al leer el PDF.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <h1>{APP_NAME}</h1>
      <p>Analiza datasheets y los convierte en circuitos simulados y animados.</p>

      <section>
        <h2>Subir datasheet</h2>
        <p>
          Límites: PDF de hasta {maxMb} MB y {LIMITS.maxPdfPages} páginas.
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
          <PdfViewer doc={loaded.doc} />
        </section>
      )}
    </main>
  );
}
