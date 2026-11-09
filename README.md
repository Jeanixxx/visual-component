# Amper

Analiza datasheets de componentes electrónicos y los convierte en circuitos simulados y animados.

Subes el PDF del fabricante, revisas lo que la app extrajo (cada dato con su página de origen) y simulas la aplicación típica para ver corriente y voltaje en el tiempo. Solo se guardan los análisis marcados con estrella.

## Estado

Hecho:
- **H0:** estructura del proyecto y esquema de datos.
- **H1:** carga de PDF con límites, visor de páginas.
- **H2 (en curso):** extracción local, sin servicios externos. Reglas de texto detectan pines, parámetros (con sección), ecuaciones; un panel de revisión deja confirmar cada dato contra su página.

Pendiente: H3 simulación con ngspice local, H4 animación, H5 estrellas y guardado local.

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
