import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

interface Props {
  doc: PDFDocumentProxy;
  page: number;
  onPageChange: (page: number) => void;
}

/** Visor de páginas de un PDF: renderiza una página a la vez en un canvas. */
export function PdfViewer({ doc, page, onPageChange }: Props) {
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;

    async function render() {
      try {
        const pdfPage = await doc.getPage(page);
        if (cancelled || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) return;

        // Escala para que la página ocupe el ancho disponible en pantalla.
        const containerWidth = canvas.parentElement?.clientWidth ?? 600;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(2, containerWidth / base.width);
        const viewport = pdfPage.getViewport({ scale });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        task = pdfPage.render({ canvasContext: context, viewport });
        await task.promise;
        setError(null);
      } catch (err) {
        if (!cancelled) {
          const name = (err as { name?: string }).name;
          if (name !== "RenderingCancelledException") {
            setError("No se pudo mostrar esta página.");
          }
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page]);

  const last = doc.numPages;

  return (
    <section id="visor">
      <nav style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px 0", flexWrap: "wrap" }}>
        <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}>
          ← Anterior
        </button>
        <span>
          Página {page} de {last}
        </span>
        <button onClick={() => onPageChange(Math.min(last, page + 1))} disabled={page >= last}>
          Siguiente →
        </button>
      </nav>
      {error && <p role="alert">{error}</p>}
      <div style={{ overflow: "auto", border: "1px solid #ddd", borderRadius: 6 }}>
        <canvas ref={canvasRef} style={{ display: "block", maxWidth: "100%" }} />
      </div>
    </section>
  );
}
