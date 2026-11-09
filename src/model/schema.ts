/**
 * Esquema de datos de un análisis de datasheet en Amper.
 * Todo dato extraído lleva página de origen y estado de revisión.
 */

export type ReviewStatus = "draft" | "reviewed";

/** Referencia a la página del datasheet de la que sale un dato. */
export interface SourceRef {
  page: number;
}

export interface Reviewable {
  /** false = borrador extraído y sin revisar; true = confirmado por el usuario. */
  reviewed: boolean;
}

export interface Pin extends SourceRef, Reviewable {
  number: number;
  name: string;
  role: string;
}

/** Sección del datasheet donde aparece un parámetro. */
export type ParamSection = "absolute-max" | "recommended" | "electrical" | "other";

export interface Parameter extends SourceRef, Reviewable {
  name: string;
  symbol: string;
  section: ParamSection;
  min: number | null;
  typ: number | null;
  max: number | null;
  unit: string;
  conditions: string;
  /** Explicación en lenguaje claro (borrador hasta revisión). */
  explanation: string;
}

export interface Equation extends SourceRef, Reviewable {
  name: string;
  /** Expresión tal como aparece en el datasheet, p. ej. "0.693 × (R1 + R2) × C". */
  expr: string;
}

export interface Netlist extends SourceRef, Reviewable {
  /** Netlist en formato SPICE. */
  text: string;
}

export interface DatasheetInfo {
  /** SHA-256 del PDF, para detectar duplicados y reutilizar la caché. */
  hash: string;
  pages: number;
  fileName: string;
}

export interface Analysis {
  id: string;
  component: string;
  manufacturer: string;
  datasheet: DatasheetInfo;
  pins: Pin[];
  parameters: Parameter[];
  equations: Equation[];
  netlist: Netlist | null;
  status: ReviewStatus;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
}
