/**
 * PPTX/PDF Generator Service — HTML-first generation with JSON fallback.
 *
 * Flow (html, default):  prompt → LLM HTML → Gotenberg screenshots → PptxGenJS → .pptx
 *                         prompt → LLM HTML → Gotenberg Chromium → .pdf
 * Flow (json, fallback): prompt → LLM JSON  → python-pptx service → .pptx
 *                         prompt → LLM JSON  → python-pptx → Gotenberg LibreOffice → .pdf
 */
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient } from './inference.service.js';
import { config } from '../config/index.js';
import { htmlToPptxViaGotenberg, htmlToPdfViaGotenberg } from './gotenberg.service.js';
import type { ContentJson, GeneratePptxResponse, Bullet } from '../types/pptx.types.js';

// ═══════════════════════════════════════════════
//  System Prompts
// ═══════════════════════════════════════════════

const CSS_DESIGN_SYSTEM = `/* === Design System === */
:root {
  --primary: #1A365D; --accent: #ED8936; --bg: #F7FAFC; --text: #2D3748;
  --muted: #A0AEC0; --white: #FFFFFF; --blue: #2B6CB0; --green: #38A169;
  --red: #E53E3E; --card-bg: #FFFFFF; --shadow: 0 2px 20px rgba(0,0,0,.06);
}
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Helvetica Neue', Arial, sans-serif; }
.slide { width:1280px; height:720px; padding:60px 80px; background:var(--bg);
         position:relative; overflow:hidden; page-break-after:always; }
.slide-cover {
  background: linear-gradient(135deg, var(--primary) 0%, #2B6CB0 100%);
  color:var(--white); display:flex; flex-direction:column; justify-content:center;
}
.slide-cover h1 { font-size:52px; font-weight:300; margin-bottom:16px; max-width:75%; letter-spacing:-0.5px; }
.slide-cover .subtitle { font-size:24px; opacity:0.85; font-weight:300; margin-bottom:40px; }
.slide-cover .meta { font-size:15px; opacity:0.6; }
.slide-cover .accent-bar { position:absolute; right:0; top:50%; transform:translateY(-50%);
  width:6px; height:160px; background:var(--accent); border-radius:3px 0 0 3px; }
.slide-cover::after { content:''; position:absolute; bottom:40px; right:60px;
  width:80px; height:80px; border:2px solid rgba(255,255,255,.15); transform:rotate(45deg); }

.slide-divider {
  background:var(--primary); color:var(--white); display:flex;
  flex-direction:column; justify-content:center; padding-left:120px;
}
.slide-divider .number { font-size:96px; font-weight:700; color:var(--accent); opacity:0.9; }
.slide-divider h2 { font-size:44px; font-weight:300; margin-top:8px; letter-spacing:-0.5px; }
.slide-divider .subtitle { font-size:20px; opacity:0.7; margin-top:16px; font-weight:300; }
.slide-divider .left-bar { position:absolute; left:0; top:0; width:8px; height:100%;
  background:var(--accent); }

.slide-content { display:flex; flex-direction:column; }
.slide-content h2 { font-size:36px; font-weight:300; color:var(--primary);
  margin-bottom:8px; letter-spacing:-0.3px; }
.slide-content .title-underline { width:50px; height:4px; background:var(--accent);
  border-radius:2px; margin-bottom:32px; }
.slide-content .body { flex:1; }
.slide-content ul { list-style:none; }
.slide-content li { font-size:20px; color:var(--text); padding:12px 0; border-bottom:1px solid #E2E8F0;
  display:flex; align-items:flex-start; gap:12px; line-height:1.5; }
.slide-content li::before { content:'▸'; color:var(--accent); font-size:16px; flex-shrink:0; margin-top:4px; }
.slide-content .footer-line { position:absolute; bottom:40px; left:80px; right:80px;
  height:1px; background:#E2E8F0; }

.slide-stats { display:flex; flex-direction:column; }
.slide-stats h2 { font-size:36px; font-weight:300; color:var(--primary); margin-bottom:40px; }
.slide-stats .cards { display:flex; gap:24px; flex:1; }
.slide-stats .card { flex:1; background:var(--card-bg); border-radius:12px; padding:32px;
  box-shadow:var(--shadow); text-align:center; display:flex; flex-direction:column;
  justify-content:center; border-top:4px solid var(--accent); }
.slide-stats .card .value { font-size:48px; font-weight:700; color:var(--primary); }
.slide-stats .card .label { font-size:16px; color:var(--muted); margin-top:8px; }

.slide-timeline h2 { font-size:36px; font-weight:300; color:var(--primary); margin-bottom:40px; }
.slide-timeline .track { position:relative; padding-left:40px; }
.slide-timeline .track::before { content:''; position:absolute; left:15px; top:8px; bottom:8px;
  width:2px; background:var(--blue); opacity:0.3; }
.slide-timeline .point { position:relative; padding:0 0 28px 28px; }
.slide-timeline .point::before { content:''; position:absolute; left:-29px; top:6px;
  width:12px; height:12px; background:var(--accent); border-radius:50%;
  box-shadow:0 0 0 4px rgba(237,137,54,.2); }
.slide-timeline .point .date { font-size:14px; color:var(--accent); font-weight:600; }
.slide-timeline .point .text { font-size:18px; color:var(--text); margin-top:4px; }

.slide-quote { display:flex; align-items:center; justify-content:center; padding:80px 120px; }
.slide-quote blockquote { font-size:36px; font-weight:300; font-style:italic; color:var(--primary);
  line-height:1.4; border-left:5px solid var(--accent); padding-left:40px; }
.slide-quote .attribution { font-size:18px; color:var(--muted); margin-top:20px;
  font-style:normal; font-weight:500; }

.slide-closing {
  background:linear-gradient(135deg, var(--primary) 0%, #1A365D 100%);
  color:var(--white); display:flex; flex-direction:column;
  justify-content:center; align-items:center; text-align:center;
}
.slide-closing h2 { font-size:48px; font-weight:300; margin-bottom:16px; }
.slide-closing .subtitle { font-size:22px; opacity:0.8; font-weight:300; margin-bottom:32px; }
.slide-closing .contact { font-size:16px; opacity:0.6; }
.slide-closing .deco { position:absolute; }
.slide-closing .deco-tr { top:30px; right:30px; width:60px; height:60px;
  border:2px solid rgba(255,255,255,.2); transform:rotate(45deg); }
.slide-closing .deco-bl { bottom:30px; left:30px; width:50px; height:50px;
  background:var(--accent); opacity:0.3; transform:rotate(45deg); }
`;

const HTML_SYSTEM_PROMPT = `You are a presentation designer. Create beautiful, professional slide decks using HTML + CSS.

## Output Format
Return ONLY valid HTML. No markdown fences, no explanations. Start directly with <section>.

${CSS_DESIGN_SYSTEM}

## Slide Types & Templates

**Cover** — always first slide:
<section class="slide slide-cover">
  <div class="accent-bar"></div>
  <h1>Presentation Title</h1>
  <div class="subtitle">Subtitle or tagline</div>
  <div class="meta">Date • Presenter Name</div>
</section>

**Divider** — between major sections (use for transition):
<section class="slide slide-divider">
  <div class="left-bar"></div>
  <div class="number">01</div>
  <h2>Section Title</h2>
  <div class="subtitle">Brief section description</div>
</section>

**Content** — main content with bullets:
<section class="slide slide-content">
  <h2>Slide Title</h2>
  <div class="title-underline"></div>
  <div class="body"><ul>
    <li>Key point one — keep concise</li>
    <li>Key point two</li>
    <li>Key point three</li>
  </ul></div>
  <div class="footer-line"></div>
</section>

**Stats Cards** — for metrics/KPIs (2-4 numbers):
<section class="slide slide-stats">
  <h2>Key Metrics</h2>
  <div class="cards">
    <div class="card"><div class="value">$12.4M</div><div class="label">Revenue Q3</div></div>
    <div class="card"><div class="value">23%</div><div class="label">YoY Growth</div></div>
    <div class="card"><div class="value">62%</div><div class="label">Gross Margin</div></div>
  </div>
</section>

**Timeline** — for chronological events/milestones:
<section class="slide slide-timeline">
  <h2>Project Timeline</h2>
  <div class="track">
    <div class="point"><div class="date">Q1 2026</div><div class="text">Initial launch</div></div>
    <div class="point"><div class="date">Q2 2026</div><div class="text">Market expansion</div></div>
    <div class="point"><div class="date">Q3 2026</div><div class="text">Series A funding</div></div>
  </div>
</section>

**Quote** — for testimonials or key statements:
<section class="slide slide-quote">
  <blockquote>Innovation distinguishes between a leader and a follower.</blockquote>
  <div class="attribution">— Steve Jobs, Apple</div>
</section>

**Closing** — always last slide:
<section class="slide slide-closing">
  <div class="deco deco-tr"></div><div class="deco deco-bl"></div>
  <h2>Thank You</h2>
  <div class="subtitle">Questions & Discussion</div>
  <div class="contact">email@company.com • linkedin.com/company</div>
</section>

## Design Rules
- Start with cover, end with closing
- Use divider between major topics (every 2-4 slides)
- Vary slide types — don't use 4 content slides in a row
- Stats cards for numeric data, timeline for chronology, quote for testimonials
- Bullets: 3-5 per slide, concise (not full paragraphs)
- Total slides: 6-20 depending on topic complexity
- Use inline style="" ONLY for unique styling. Use classes for everything else.
- Ensure HTML is well-formed: close all tags, proper nesting.`;

const JSON_SYSTEM_PROMPT = `You are a presentation content architect. Output ONLY valid JSON — no markdown, no explanations.

## Slide Types (use the "type" field exactly)
1. cover           — { "type": "cover", "title": "...", "subtitle"?: "...", "date"?: "...", "presenter"?: "..." }
2. section_divider — { "type": "section_divider", "section_number"?: "01", "title": "..." }
3. content         — { "type": "content", "title": "...", "bullets": [{"text": "...", "level": 0}] }
4. comparison      — { "type": "comparison", "title": "...", "left": {"heading": "...", "points": ["..."]}, "right": {"heading": "...", "points": ["..."]} }
5. chart           — { "type": "chart", "title": "...", "chart_type": "bar"|"line"|"pie", "categories": ["..."], "series": [{"name": "...", "values": [1,2]}], "insight"?: "..." }
6. closing         — { "type": "closing", "title": "...", "subtitle"?: "...", "contact"?: "..." }

## Rules
- Start with cover, end with closing
- 3-5 bullets per content slide
- Use comparison for vs/before-after, chart for data
- 5-20 slides total

## Output Format
{
  "meta": { "title": "Deck Title", "subtitle"?: "...", "presenter"?: "...", "date"?: "..." },
  "slides": [
    { "type": "cover", "title": "Title Slide", "subtitle": "..." },
    { "type": "content", "title": "Key Points", "bullets": [{"text": "...", "level": 0}] },
    { "type": "closing", "title": "Thank You" }
  ]
}

Every slide MUST have "type" set to one of the 6 values above.`;

// ═══════════════════════════════════════════════
//  JSON Validation (fallback path)
// ═══════════════════════════════════════════════

const VALID_SLIDE_TYPES = new Set(['cover', 'content', 'section_divider', 'comparison', 'chart', 'closing']);

function validateContentJson(data: unknown): ContentJson {
  if (!data || typeof data !== 'object') throw new Error('Content JSON must be an object');
  const d = data as Record<string, unknown>;
  if (!d.meta || typeof d.meta !== 'object') throw new Error('meta is required');
  const meta = d.meta as Record<string, unknown>;
  if (!meta.title || typeof meta.title !== 'string') throw new Error('meta.title is required');
  if (!Array.isArray(d.slides) || d.slides.length === 0) throw new Error('slides must be a non-empty array');
  if (d.slides.length > 30) throw new Error('Maximum 30 slides');
  for (let i = 0; i < d.slides.length; i++) {
    const s = d.slides[i] as Record<string, unknown>;
    // Auto-fix null/undefined type (LLM hallucination)
    if (s.type === null || s.type === undefined || s.type === 'undefined' || s.type === 'null') {
      s.type = s.chart_type ? 'chart' : s.bullets ? 'content' : s.left ? 'comparison' : 'content';
    }
    if (!s.type || typeof s.type !== 'string' || !VALID_SLIDE_TYPES.has(s.type)) {
      throw new Error(`Slide ${i}: invalid type '${s.type}' (valid: ${[...VALID_SLIDE_TYPES].join(', ')})`);
    }
    if (!s.title || typeof s.title !== 'string') throw new Error(`Slide ${i}: title required`);
  }
  return data as ContentJson;
}

// ═══════════════════════════════════════════════
//  LLM Helpers
// ═══════════════════════════════════════════════

function parseLLMText(raw: string): string {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:html|json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
  return cleaned;
}

// ═══════════════════════════════════════════════
//  HTML Generation (default path)
// ═══════════════════════════════════════════════

export async function generateHtmlSlides(
  prompt: string,
  modelId?: string,
): Promise<{ html: string; modelUsed: string }> {
  const model = modelId || 'qwen.qwen3-235b-a22b-2507-v1:0';
  const userMessage = { role: 'user' as const, content: [{ text: prompt }] };

  let rawResponse = '';
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    let retryHint = '';
    if (attempt > 0 && lastError) {
      retryHint = `ERROR: ${lastError.message}. Fix and return ONLY valid HTML (no markdown wrapping, no explanations). Start with <section class="slide...">.`;
    }

    const messages = attempt === 0
      ? [userMessage]
      : [userMessage, { role: 'assistant' as const, content: [{ text: rawResponse }] }, { role: 'user' as const, content: [{ text: retryHint }] }];

    const command = new ConverseCommand({
      modelId: model,
      system: [{ text: HTML_SYSTEM_PROMPT }],
      messages,
      inferenceConfig: { maxTokens: 8192, temperature: attempt === 0 ? 0.4 : 0.2 },
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await bedrockClient.send(command, { abortSignal: controller.signal });
      rawResponse = response.output?.message?.content?.[0]?.text ?? '';

      const html = parseLLMText(rawResponse);

      // Validate: must contain <section class="slide
      if (!/<section[^>]*class=["'][^"']*slide[^"']*["']/i.test(html)) {
        throw new Error('No slide sections found. Output must contain <section class="slide ..."> elements.');
      }

      // Validate: must have at least cover and closing (or at least 2 slides)
      const slideCount = (html.match(/<section[^>]*class=["'][^"']*slide/g) || []).length;
      if (slideCount < 2) {
        throw new Error(`Only ${slideCount} slide(s) found. Minimum 2 slides required (cover + content).`);
      }

      return { html, modelUsed: model };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === 2) throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error('Failed to generate HTML slides');
}

// ═══════════════════════════════════════════════
//  JSON Generation (fallback path)
// ═══════════════════════════════════════════════

export async function generateContentJson(
  prompt: string,
  modelId?: string,
): Promise<{ content: ContentJson; rawJson: string; modelUsed: string }> {
  const model = modelId || 'qwen.qwen3-235b-a22b-2507-v1:0';
  const userMessage = { role: 'user' as const, content: [{ text: prompt }] };

  let rawResponse = '';
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    let retryPrompt = '';
    if (attempt > 0 && lastError) {
      const errMsg = lastError.message;
      if (errMsg.includes('left column required') || errMsg.includes('right column required')) {
        retryPrompt = `ERROR: Comparison slide missing left/right. Must be: {"type":"comparison","title":"...","left":{"heading":"...","points":["..."]},"right":{"heading":"...","points":["..."]}}`;
      } else if (errMsg.includes('invalid type')) {
        retryPrompt = `ERROR: Invalid slide type. Valid: cover, content, section_divider, comparison, chart, closing.`;
      } else {
        retryPrompt = `ERROR: ${errMsg}. Fix and return ONLY valid JSON.`;
      }
    }

    const command = new ConverseCommand({
      modelId: model,
      system: [{ text: JSON_SYSTEM_PROMPT }],
      messages: attempt === 0
        ? [userMessage]
        : [userMessage, { role: 'assistant' as const, content: [{ text: rawResponse }] }, { role: 'user' as const, content: [{ text: retryPrompt }] }],
      inferenceConfig: { maxTokens: 4096, temperature: attempt === 0 ? 0.2 : 0.1 },
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await bedrockClient.send(command, { abortSignal: controller.signal });
      rawResponse = response.output?.message?.content?.[0]?.text ?? '';

      const parsed = JSON.parse(parseLLMText(rawResponse));
      const validated = validateContentJson(parsed);
      return { content: validated, rawJson: rawResponse, modelUsed: model };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === 2) throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error('Failed to generate Content JSON');
}

// ═══════════════════════════════════════════════
//  Main Generation Pipeline
// ═══════════════════════════════════════════════

export async function generatePptx(
  prompt: string,
  modelId?: string,
  template?: string,
  format: 'html' | 'json' = 'html',
): Promise<GeneratePptxResponse> {
  const safeTitle = prompt.replace(/[^a-z0-9\-_ ]/gi, '').replace(/\s+/g, '-').slice(0, 40) || 'presentation';
  const timestamp = new Date().toISOString().slice(0, 10);

  if (format === 'html') {
    const { html } = await generateHtmlSlides(prompt, modelId);
    const buffer = await htmlToPptxViaGotenberg(html);
    return { buffer, filename: `${safeTitle}-${timestamp}.pptx` };
  }

  // JSON fallback — uses python-pptx service
  const { content } = await generateContentJson(prompt, modelId);
  const serviceUrl = config.pptx?.serviceUrl;
  if (!serviceUrl) throw new Error('PPTX_SERVICE_URL not configured');

  const response = await fetch(`${serviceUrl}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template: template || 'corporate', meta: content.meta, slides: content.slides }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => 'Unknown error');
    throw new Error(`PPTX service returned ${response.status}: ${errText}`);
  }
  return { buffer: Buffer.from(await response.arrayBuffer()), filename: `${safeTitle}-${timestamp}.pptx` };
}

export async function generatePdf(
  prompt: string,
  modelId?: string,
  format: 'html' | 'json' = 'html',
): Promise<GeneratePptxResponse> {
  const safeTitle = prompt.replace(/[^a-z0-9\-_ ]/gi, '').replace(/\s+/g, '-').slice(0, 40) || 'presentation';
  const timestamp = new Date().toISOString().slice(0, 10);

  if (format === 'html') {
    const { html } = await generateHtmlSlides(prompt, modelId);
    const buffer = await htmlToPdfViaGotenberg(html);
    return { buffer, filename: `${safeTitle}-${timestamp}.pdf` };
  }

  // JSON fallback: generate PPTX then convert via Gotenberg LibreOffice
  const pptxResult = await generatePptx(prompt, modelId, undefined, 'json');
  const { convertPptxToPdf } = await import('./gotenberg.service.js');
  const pdfBuffer = await convertPptxToPdf(pptxResult.buffer, pptxResult.filename);
  return { buffer: pdfBuffer, filename: pptxResult.filename.replace(/\.pptx$/, '.pdf') };
}
