/**
 * Límites y parámetros globales de Amper.
 * Ajustables; se revisan tras el piloto con el NE555.
 */
export const LIMITS = {
  /** Tamaño máximo del datasheet PDF, en bytes (20 MB). */
  maxPdfBytes: 20 * 1024 * 1024,
  /** Número máximo de páginas aceptadas por datasheet. */
  maxPdfPages: 300,
} as const;

export const APP_NAME = "Amper";
