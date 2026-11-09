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

Primer componente de prueba: **NE555** (Texas Instruments).

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
