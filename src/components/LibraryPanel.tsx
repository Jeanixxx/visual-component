import { useRef, useState, type ChangeEvent } from "react";
import type { Analysis } from "../model/schema";
import { buildExport, downloadBlob, parseImport } from "../storage/exchange";

interface Props {
  items: Analysis[];
  error: string | null;
  onOpen: (a: Analysis) => void;
  onRemove: (id: string) => void;
  onImport: (list: Analysis[]) => Promise<void>;
}

function safeName(s: string): string {
  return s.replace(/[^\w-]+/g, "_").slice(0, 60) || "analisis";
}

/** Biblioteca local: análisis marcados con estrella. */
export function LibraryPanel({ items, error, onOpen, onRemove, onImport }: Props) {
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportError(null);
    try {
      const list = parseImport(await file.text());
      await onImport(list);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "No se pudo importar el archivo.");
    }
  }

  return (
    <section>
      <h2>Biblioteca ({items.length})</h2>
      <p style={{ fontSize: 13, color: "#555" }}>
        Solo se guardan los análisis con estrella, en este navegador. Puedes exportarlos a un archivo JSON para respaldarlos.
      </p>

      {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
      {importError && <p role="alert" style={{ color: "#b00020" }}>{importError}</p>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <button disabled={items.length === 0} onClick={() => downloadBlob(buildExport(items), "amper-biblioteca.json")}>
          Exportar todo
        </button>
        <button onClick={() => fileRef.current?.click()}>Importar JSON</button>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} hidden />
      </div>

      {items.length === 0 ? (
        <p style={{ fontSize: 14 }}>Todavía no hay análisis guardados.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {items.map((a) => (
            <li key={a.id} style={{ borderTop: "1px solid #ddd", padding: "8px 0", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ flex: "1 1 180px" }}>
                <strong>★ {a.component}</strong> · {a.manufacturer}
                <br />
                <span style={{ fontSize: 12, color: "#555" }}>
                  {a.pins.length} pines · {a.parameters.length} parámetros · {a.equations.length} ecuaciones · {a.status === "reviewed" ? "revisado" : "borrador"}
                </span>
              </span>
              <button onClick={() => onOpen(a)}>Abrir</button>
              <button onClick={() => downloadBlob(buildExport([a]), `amper-${safeName(a.component)}.json`)}>Exportar</button>
              <button onClick={() => onRemove(a.id)} aria-label={`Quitar ${a.component} de la biblioteca`}>Quitar</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
