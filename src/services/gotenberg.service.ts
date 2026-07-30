/**
 * Gotenberg Service — converts legacy Office documents (.doc, .ppt) to PDF
 * via Gotenberg's LibreOffice endpoint, then extracts text using pdf-parse.
 *
 * Gotenberg is deployed as a separate Cloud Run service:
 *   - Image: gotenberg/gotenberg:8
 *   - Endpoint: /forms/libreoffice/convert
 *   - Resources: 2 vCPU / 4GB RAM
 *
 * GOTENBERG_URL env var must point to the Gotenberg service (e.g.
 * https://gotenberg-xxxxx-uc.a.run.app).
 *
 * @see Requirements 1.1, 1.2
 */

import { config } from '../config/index.js';
import { extractPdfText } from './document-extractor.service.js';
import type { ExtractionResult } from '../types/upload.types.js';

/**
 * Convert a legacy Office document (.doc, .ppt) to text via Gotenberg → PDF → pdf-parse.
 *
 * Steps:
 *   1. POST file buffer to Gotenberg /forms/libreoffice/convert
 *   2. Receive PDF response
 *   3. Extract text from PDF via pdf-parse
 *
 * Graceful degradation: returns low-confidence empty result if Gotenberg is
 * not configured or unreachable. Never throws.
 */
export async function convertViaGotenberg(
  buffer: Buffer,
  filename: string,
): Promise<ExtractionResult> {
  const gotenbergUrl = config.gotenberg.url;
  if (!gotenbergUrl) {
    console.warn('[gotenberg] GOTENBERG_URL not configured — skipping conversion');
    return { text: '', filename, isEmpty: true, confidence: 'low', format: 'unknown' };
  }

  const ext = filename.split('.').pop()?.toLowerCase() || 'doc';
  const endpoint = `${gotenbergUrl}/forms/libreoffice/convert`;

  try {
    // Build multipart form
    const form = new FormData();
    form.append('files', new Blob([buffer as any], { type: 'application/octet-stream' }), filename);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.gotenberg.timeoutMs);

    const response = await fetch(endpoint, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[gotenberg] API returned ${response.status} for ${filename}`);
      return { text: '', filename, isEmpty: true, confidence: 'low', format: ext };
    }

    // Response is a PDF — extract text via pdf-parse
    const pdfBuffer = Buffer.from(await response.arrayBuffer());
    const result = await extractPdfText(pdfBuffer, filename.replace(/\.(doc|ppt)$/i, '.pdf'));

    return {
      ...result,
      format: ext, // Report original format, not pdf
    };
  } catch (error) {
    console.error(`[gotenberg] Conversion failed for ${filename}:`, (error as Error).message);
    return { text: '', filename, isEmpty: true, confidence: 'low', format: ext };
  }
}

/**
 * Convert a .pptx buffer to PDF via Gotenberg LibreOffice.
 * Returns raw PDF buffer. Throws on failure.
 */
export async function convertPptxToPdf(pptxBuffer: Buffer, filename: string = 'presentation.pptx'): Promise<Buffer> {
  const gotenbergUrl = config.gotenberg.url;
  if (!gotenbergUrl) {
    throw new Error('GOTENBERG_URL not configured');
  }

  const form = new FormData();
  form.append('files', new Blob([pptxBuffer as any], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), filename);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.gotenberg.timeoutMs);

  try {
    const response = await fetch(`${gotenbergUrl}/forms/libreoffice/convert`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Gotenberg returned ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convert HTML slides to PDF via Gotenberg Chromium.
 * Each <section class="slide"> becomes a page with perfect CSS rendering.
 */
export async function htmlToPdfViaGotenberg(html: string): Promise<Buffer> {
  const gotenbergUrl = config.gotenberg.url;
  if (!gotenbergUrl) throw new Error('GOTENBERG_URL not configured');

  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  const form = new FormData();
  form.append('files', new Blob([fullHtml], { type: 'text/html' }), 'index.html');
  form.append('paperWidth', '13.33');  // 16:9 in inches
  form.append('paperHeight', '7.5');
  form.append('marginTop', '0');
  form.append('marginBottom', '0');
  form.append('marginLeft', '0');
  form.append('marginRight', '0');
  form.append('printBackground', 'true');
  form.append('preferCssPageSize', 'true');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.gotenberg.timeoutMs);

  try {
    const response = await fetch(`${gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Gotenberg Chromium PDF returned ${response.status}: ${errText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

import JSZip from 'jszip';

// ── Minimal PPTX Builder (via JSZip — no extra dependency) ──

const PPTX_XML = {
  contentTypes: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="png" ContentType="image/png"/>
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`,

  rels: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,

  presRels: (slideCount: number) => {
    let xml = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>`;
    for (let i = 0; i < slideCount; i++) {
      xml += `<Relationship Id="rId${i + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`;
    }
    xml += `</Relationships>`;
    return xml;
  },

  presentation: (slideCount: number) => `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldMasterIdLst><p:sldMasterId id="1" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${Array.from({ length: slideCount }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,

  slideRel: (slideIdx: number) => `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${slideIdx}.png"/></Relationships>`,

  slide: (slideIdx: number) => `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="slide${slideIdx}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`,

  slideMaster: `<?xml version="1.0" encoding="UTF-8"?><p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,

  slideMasterRels: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,

  slideLayout: `<?xml version="1.0" encoding="UTF-8"?><p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld></p:sldLayout>`,

  theme: `<?xml version="1.0" encoding="UTF-8"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Default"><a:themeElements><a:clrScheme name="Default"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1A365D"/></a:dk2><a:lt2><a:srgbClr val="F7FAFC"/></a:lt2><a:accent1><a:srgbClr val="2B6CB0"/></a:accent1><a:accent2><a:srgbClr val="ED8936"/></a:accent2><a:accent3><a:srgbClr val="38A169"/></a:accent3><a:accent4><a:srgbClr val="E53E3E"/></a:accent4><a:accent5><a:srgbClr val="805AD5"/></a:accent5><a:accent6><a:srgbClr val="DD6B20"/></a:accent6><a:hlink><a:srgbClr val="2B6CB0"/></a:hlink><a:folHlink><a:srgbClr val="805AD5"/></a:folHlink></a:clrScheme><a:fontScheme name="Default"><a:majorFont><a:latin typeface="Helvetica"/></a:majorFont><a:minorFont><a:latin typeface="Helvetica"/></a:minorFont></a:fontScheme><a:fmtScheme name="Default"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst></a:fmtScheme></a:themeElements></a:theme>`,
};

function buildPptxZip(images: Buffer[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', PPTX_XML.contentTypes);
  zip.file('_rels/.rels', PPTX_XML.rels);
  zip.file('ppt/presentation.xml', PPTX_XML.presentation(images.length));
  zip.file('ppt/_rels/presentation.xml.rels', PPTX_XML.presRels(images.length));
  zip.file('ppt/slideMasters/slideMaster1.xml', PPTX_XML.slideMaster);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', PPTX_XML.slideMasterRels);
  zip.file('ppt/slideLayouts/slideLayout1.xml', PPTX_XML.slideLayout);
  zip.file('ppt/theme/theme1.xml', PPTX_XML.theme);

  const pptDir = zip.folder('ppt');
  const slidesDir = pptDir!.folder('slides');
  const slidesRelsDir = slidesDir!.folder('_rels');
  const mediaDir = pptDir!.folder('media');

  for (let i = 0; i < images.length; i++) {
    slidesDir!.file(`slide${i + 1}.xml`, PPTX_XML.slide(i + 1));
    slidesRelsDir!.file(`slide${i + 1}.xml.rels`, PPTX_XML.slideRel(i + 1));
    mediaDir!.file(`image${i + 1}.png`, images[i], { binary: true });
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 1 } });
}

/**
 * Convert HTML slides to PPTX via Gotenberg Chromium screenshots → JSZip PPTX.
 * Parses <section class="slide..."> elements, screenshots each, composes as full-slide images.
 */
export async function htmlToPptxViaGotenberg(html: string): Promise<Buffer> {
  const gotenbergUrl = config.gotenberg.url;
  if (!gotenbergUrl) throw new Error('GOTENBERG_URL not configured');

  // Extract individual slide HTML strings
  const slideRegex = /<section([^>]*)>([\s\S]*?)<\/section>/gi;
  const slides: string[] = [];
  let match;
  while ((match = slideRegex.exec(html)) !== null) {
    slides.push(match[0]);
  }

  if (slides.length === 0) {
    throw new Error('No <section> elements found in HTML');
  }

  // Screenshot each slide via Gotenberg Chromium (max 5 concurrent)
  const screenshotSlide = async (slideHtml: string, index: number): Promise<{ data: Buffer; index: number }> => {
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{width:1280px;height:720px;overflow:hidden;}</style></head><body>${slideHtml}</body></html>`;
    const form = new FormData();
    form.append('files', new Blob([fullHtml], { type: 'text/html' }), 'slide.html');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch(`${gotenbergUrl}/forms/chromium/screenshot/html`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Gotenberg screenshot returned ${response.status} for slide ${index}`);
      }
      const buf = Buffer.from(await response.arrayBuffer());
      return { data: buf, index };
    } finally {
      clearTimeout(timeout);
    }
  };

  // Process in batches of 5
  const results: { data: Buffer; index: number }[] = [];
  for (let i = 0; i < slides.length; i += 5) {
    const batch = slides.slice(i, i + 5).map((s, j) => screenshotSlide(s, i + j));
    const batchResults = await Promise.all(batch);
    results.push(...batchResults);
  }
  results.sort((a, b) => a.index - b.index);

  return buildPptxZip(results.map(r => r.data));
}
