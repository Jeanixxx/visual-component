import { APP_NAME, LIMITS } from "./config";

export function App() {
  const maxMb = LIMITS.maxPdfBytes / (1024 * 1024);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16, maxWidth: 720, margin: "0 auto" }}>
      <h1>{APP_NAME}</h1>
      <p>Analiza datasheets y los convierte en circuitos simulados y animados.</p>
      <section>
        <h2>Subir datasheet</h2>
        <p>
          Límites: PDF de hasta {maxMb} MB y {LIMITS.maxPdfPages} páginas.
        </p>
        <p><em>Pendiente (H1): carga de PDF y visor.</em></p>
      </section>
    </main>
  );
}
