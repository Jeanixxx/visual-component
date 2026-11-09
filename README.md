# Amper

Analiza datasheets de componentes electrónicos y los convierte en circuitos simulados y animados.

Subes el PDF del fabricante, revisas lo que la app extrajo (cada dato con su página de origen) y simulas la aplicación típica para ver corriente y voltaje en el tiempo. Solo se guardan los análisis marcados con estrella.

## Estado

Hecho:
- **H0:** estructura del proyecto y esquema de datos.
- **H1:** carga de PDF con límites, visor de páginas.
- **H2:** extracción local, sin servicios externos. Reglas de texto detectan pines, parámetros (con sección) y ecuaciones; un panel de revisión deja confirmar cada dato contra su página.
- **H3:** simulación local del NE555 astable con ngspice (WebAssembly). Modelo ideal basado en el diagrama de bloques del datasheet, verificado contra t_alto ≈ 0.693·(R1+R2)·C y t_bajo ≈ 0.693·R2·C dentro de ±5 %. El motor (~20 MB) se carga solo al simular.

- **H4:** animación del flujo de corriente. Las corrientes salen de los voltajes simulados (I = ΔV/R, y I_C = I_R2) y los puntos avanzan según la carga acumulada: más corriente, más rápido. Verificado: la carga que entra al condensador es igual a C·ΔV y la ley de corrientes en DIS se cumple.

- **H5:** biblioteca local. Solo se guardan los análisis con estrella, en IndexedDB del navegador; las ediciones de revisión de un análisis con estrella se guardan al hacerlas. Exportar e importar en JSON con validación de formato.

Pendiente: decidir si la biblioteca debe guardar también el PDF, para abrir el visor desde un análisis guardado. Hoy un análisis abierto desde la biblioteca muestra las páginas como texto.

Motor genérico (no ligado a un componente):
- **Extracción** (src/extract): reglas para cualquier datasheet. Probado con el NE555 real y con tres documentos sintéticos de estilos distintos (tablas partidas, símbolo al final, español con índice). Lo que no se reconoce se marca para revisión; nunca se inventa un valor.
- **Simulación** (src/sim/templates.ts): cada circuito es una plantilla con sus parámetros, su netlist y su medida frente a la ecuación de referencia. Plantillas: astable NE555, filtro RC (verificado con dos juegos de valores), y netlist libre.

- **OCR local** (src/ocr): si un PDF no tiene texto seleccionable (escaneo), se lee con tesseract.js en el navegador. El motor, el worker y los datos de idioma salen del propio sitio (public/ocr, copiados por scripts/copy-ocr-assets.mjs): no se descarga nada de un CDN. Resolución explícita por página y modo de columna; las filas obtenidas con OCR llevan la nota "OCR: verificar contra la página", porque el OCR puede confundir caracteres.

Validado con datasheets reales de TI, onsemi, Nexperia, Everlight, Sharp (escaneo), Mornsun, Microne, Hongfa y módulos (ESP8266, HC-SR04). Los resultados varían por documento; lo que no se reconoce se deja para revisión manual.

- **Modo flexible** (src/extract/buildDraft.ts): si con los encabezados de sección reconocidos salen menos de 3 parámetros, la app vuelve a leer sin depender de ellos (todo va a «Otros»). Los pines sin encabezado se detectan por lista numerada o de bolas BGA. Probado quitando los encabezados a documentos reales: los parámetros salen igual o mejor.
- **Informe del análisis** (src/components/ReportPanel.tsx): explica qué se leyó, qué modo se usó, qué encabezados se reconocieron y qué líneas con valor y unidad no se pudieron interpretar; muestra el texto detectado de cada página y permite copiar el informe o el texto completo.
- **Filas manuales**: «+ Agregar pin / parámetro / ecuación» en la revisión, para completar lo que el análisis no pudo leer.

Pendiente: enlazar automáticamente un análisis con una plantilla y capturar la tabla eléctrica del NE555 por líneas.

Ver el plan completo en la documentación del proyecto.

## Desarrollo

Requisitos: Node.js 18 o superior.

```bash
npm install
npm run dev        # servidor de desarrollo
npm run typecheck  # verificación de tipos
npm run build      # compilación de producción
```

## Límites

- PDF: hasta 20 MB y 300 páginas (`src/config.ts`).
- Requiere conexión para la extracción con modelo en la nube.

## Estructura

```
src/
  config.ts          límites y constantes
  model/schema.ts    esquema de un análisis (pines, parámetros, ecuaciones, netlist)
  App.tsx            interfaz principal
  main.tsx           punto de entrada
```
