// Copia el motor de OCR (tesseract.js) y sus datos de idioma desde node_modules a public/ocr,
// para que el sitio los sirva él mismo y no dependa de ningún CDN.
import { cpSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = join(root, "node_modules");
const out = join(root, "public", "ocr");

const files = [
  // [origen, destino relativo a public/ocr]
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "lang/eng.traineddata.gz"],
];

// El motor trae varias variantes (con y sin SIMD, con y sin LSTM): tesseract.js elige la que el
// dispositivo soporta, así que se copian todas las que traiga el paquete.
const coreDir = join(nm, "tesseract.js-core");
if (!existsSync(coreDir)) {
  console.error("Falta tesseract.js-core. Ejecuta npm install.");
  process.exit(1);
}
for (const name of readdirSync(coreDir)) {
  if (name.startsWith("tesseract-core") && name.endsWith(".wasm.js")) {
    files.push([`tesseract.js-core/${name}`, `core/${name}`]);
  }
}

for (const [from, to] of files) {
  const src = join(nm, from);
  if (!existsSync(src)) {
    console.error(`Falta ${from}. Ejecuta npm install.`);
    process.exit(1);
  }
  const dest = join(out, to);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
}
console.log(`OCR: ${files.length} archivos copiados a public/ocr`);
