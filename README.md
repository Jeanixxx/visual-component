# Amper

Analiza datasheets de componentes electrónicos y los convierte en circuitos simulados y animados.

Subes el PDF del fabricante, revisas lo que la app extrajo (cada dato con su página de origen) y simulas la aplicación típica para ver corriente y voltaje en el tiempo. Solo se guardan los análisis marcados con estrella.

## Estado

H0 en curso: estructura del proyecto y esquema de datos. Primer componente de prueba: **NE555** (Texas Instruments).

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
