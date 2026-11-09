# Amper

Analiza datasheets de componentes electrónicos y los convierte en circuitos simulados y animados.

Subes el PDF del fabricante, revisas lo que la app extrajo (cada dato con su página de origen) y simulas la aplicación típica para ver corriente y voltaje en el tiempo. Solo se guardan los análisis marcados con estrella.

## Estado

Hecho:
- **H0:** estructura del proyecto y esquema de datos.
- **H1:** carga de PDF con límites, visor de páginas.
- **H2:** extracción local, sin servicios externos. Reglas de texto detectan pines, parámetros (con sección) y ecuaciones; un panel de revisión deja confirmar cada dato contra su página.
- **H3:** simulación local del NE555 astable con ngspice (WebAssembly). Modelo ideal basado en el diagrama de bloques del datasheet, verificado contra t_alto ≈ 0.693·(R1+R2)·C y t_bajo ≈ 0.693·R2·C dentro de ±5 %. El motor (~20 MB) se carga solo al simular.

Pendiente: H4 animación de corriente y voltaje, H5 estrellas y guardado local.

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
