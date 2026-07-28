/**
 * PPTX generation types — mirrors python-pptx service Pydantic schemas.
 * Used for Content JSON validation (Zod) and API contracts.
 */

// ── Slide Content Types ──

export interface Bullet {
  text: string;
  level: number; // 0-2 indentation
}

export interface CoverSlide {
  type: 'cover';
  title: string;
  subtitle?: string;
  date?: string;
  presenter?: string;
}

export interface ContentSlide {
  type: 'content';
  title: string;
  bullets: Bullet[];
  notes?: string;
}

export interface SectionDividerSlide {
  type: 'section_divider';
  section_number: string;
  title: string;
  subtitle?: string;
}

export interface ComparisonColumn {
  heading: string;
  points: string[];
}

export interface ComparisonSlide {
  type: 'comparison';
  title: string;
  left: ComparisonColumn;
  right: ComparisonColumn;
}

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartSlide {
  type: 'chart';
  title: string;
  chart_type: 'bar' | 'line' | 'pie';
  categories: string[];
  series: ChartSeries[];
  insight?: string;
}

export interface ClosingSlide {
  type: 'closing';
  title: string;
  subtitle?: string;
  contact?: string;
}

export type Slide =
  | CoverSlide
  | ContentSlide
  | SectionDividerSlide
  | ComparisonSlide
  | ChartSlide
  | ClosingSlide;

export interface SlideMeta {
  title: string;
  subtitle?: string;
  presenter?: string;
  date?: string;
}

// ── API Contracts ──

export interface ContentJson {
  meta: SlideMeta;
  slides: Slide[];
}

export interface GeneratePptxRequest {
  prompt: string;
  /** Model ID override — defaults to qwen3-235b */
  modelId?: string;
  /** Template name — defaults to "corporate" */
  template?: string;
}

export interface GeneratePptxResponse {
  /** Buffer containing the .pptx file */
  buffer: Buffer;
  /** Suggested filename */
  filename: string;
}
