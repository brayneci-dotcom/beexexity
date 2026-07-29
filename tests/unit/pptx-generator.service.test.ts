/**
 * PPTX Generator Service — unit tests for HTML validation, themes, and JSON parsing.
 */
import { describe, it, expect } from 'vitest';
import { validateSlides } from '../../src/services/pptx-generator.service.js';
import { VALID_THEMES, VALID_LAYOUTS } from '../../src/services/pptx-themes.js';

// ═══════════════════════════════════════════════
//  Theme + Layout Constants
// ═══════════════════════════════════════════════

describe('Theme Registry', () => {
  it('should have exactly 10 themes', () => {
    expect(VALID_THEMES.size).toBe(10);
  });

  it('should contain all expected theme names', () => {
    const expected = [
      'theme-executive', 'theme-neon', 'theme-minimal', 'theme-pop',
      'theme-ledger', 'theme-teal', 'theme-earth', 'theme-pitch',
      'theme-statute', 'theme-academic',
    ];
    for (const t of expected) {
      expect(VALID_THEMES.has(t)).toBe(true);
    }
  });
});

describe('Layout Registry', () => {
  it('should have exactly 7 layouts', () => {
    expect(VALID_LAYOUTS.size).toBe(7);
  });

  it('should contain all expected layout names', () => {
    const expected = [
      'layout-hero', 'layout-split', 'layout-bento-3', 'layout-bento-4',
      'layout-timeline', 'layout-quote', 'layout-content',
    ];
    for (const l of expected) {
      expect(VALID_LAYOUTS.has(l)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════
//  HTML Validation — Theme Consistency
// ═══════════════════════════════════════════════

describe('validateSlides — Theme Consistency', () => {
  it('should accept all slides with same theme', () => {
    const html = `
      <section class="slide theme-executive layout-hero"><h1>Cover</h1></section>
      <section class="slide theme-executive layout-bento-3"><h2>Metrics</h2><div class="bento-grid"><div class="card center"><div class="stat-value">100</div><div class="stat-label">Users</div></div><div class="card center"><div class="stat-value">50</div><div class="stat-label">Revenue</div></div><div class="card center"><div class="stat-value">25</div><div class="stat-label">NPS</div></div></div></section>
      <section class="slide theme-executive layout-timeline"><h2>Timeline</h2><div class="track"><div class="point"><div class="date">Q1</div><div class="text">Launch</div></div></div></section>
      <section class="slide theme-executive layout-hero center"><h1>Thanks</h1></section>
    `;
    const result = validateSlides(html);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject mixed themes', () => {
    const html = `
      <section class="slide theme-executive layout-hero"><h1>Cover</h1></section>
      <section class="slide theme-neon layout-bento-3"><h2>Metrics</h2><div class="bento-grid"><div class="card center"><div class="stat-value">100</div><div class="stat-label">X</div></div><div class="card center"><div class="stat-value">50</div><div class="stat-label">Y</div></div><div class="card center"><div class="stat-value">25</div><div class="stat-label">Z</div></div></div></section>
      <section class="slide theme-executive layout-hero center"><h1>Thanks</h1></section>
    `;
    const result = validateSlides(html);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Inconsistent themes'))).toBe(true);
  });

  it('should reject missing theme', () => {
    const html = `
      <section class="slide layout-hero"><h1>Cover</h1></section>
      <section class="slide layout-hero center"><h1>Thanks</h1></section>
    `;
    const result = validateSlides(html);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('No valid theme'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════
//  HTML Validation — Layout Diversity
// ═══════════════════════════════════════════════

describe('validateSlides — Layout Diversity', () => {
  it('should reject consecutive same layout', () => {
    const html = `
      <section class="slide theme-executive layout-bento-3"><h2>Slide 1</h2><div class="bento-grid"><div class="card center"><div class="stat-value">A</div><div class="stat-label">a</div></div><div class="card center"><div class="stat-value">B</div><div class="stat-label">b</div></div><div class="card center"><div class="stat-value">C</div><div class="stat-label">c</div></div></div></section>
      <section class="slide theme-executive layout-bento-3"><h2>Slide 2</h2><div class="bento-grid"><div class="card center"><div class="stat-value">D</div><div class="stat-label">d</div></div><div class="card center"><div class="stat-value">E</div><div class="stat-label">e</div></div><div class="card center"><div class="stat-value">F</div><div class="stat-label">f</div></div></div></section>
      <section class="slide theme-executive layout-hero"><h1>Cover</h1></section>
      <section class="slide theme-executive layout-hero center"><h1>Thanks</h1></section>
    `;
    const result = validateSlides(html);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Consecutive duplicate layout'))).toBe(true);
  });

  it('should reject layout-content used more than once', () => {
    const html = `
      <section class="slide theme-executive layout-hero"><h1>Cover</h1></section>
      <section class="slide theme-executive layout-content"><h2>Bullets 1</h2><ul><li>A</li><li>B</li></ul></section>
      <section class="slide theme-executive layout-content"><h2>Bullets 2</h2><ul><li>C</li><li>D</li></ul></section>
      <section class="slide theme-executive layout-hero center"><h1>Thanks</h1></section>
    `;
    const result = validateSlides(html);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('layout-content used'))).toBe(true);
  });

  it('should accept varied layouts', () => {
    const html = `
      <section class="slide theme-minimal layout-hero"><h1>Cover</h1></section>
      <section class="slide theme-minimal layout-bento-3"><h2>Metrics</h2><div class="bento-grid"><div class="card center"><div class="stat-value">A</div><div class="stat-label">a</div></div><div class="card center"><div class="stat-value">B</div><div class="stat-label">b</div></div><div class="card center"><div class="stat-value">C</div><div class="stat-label">c</div></div></div></section>
      <section class="slide theme-minimal layout-timeline"><h2>Roadmap</h2><div class="track"><div class="point"><div class="date">Q1</div><div class="text">Item</div></div></div></section>
      <section class="slide theme-minimal layout-quote"><blockquote>Great work</blockquote><div class="attribution">— CEO</div></section>
      <section class="slide theme-minimal layout-hero center"><h1>Thanks</h1></section>
    `;
    const result = validateSlides(html);
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════
//  HTML Validation — Structure
// ═══════════════════════════════════════════════

describe('validateSlides — Structure', () => {
  it('should reject empty input', () => {
    const result = validateSlides('<div>no slides</div>');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('No slide sections'))).toBe(true);
  });

  it('should reject fewer than 4 slides', () => {
    const html = `
      <section class="slide theme-executive layout-hero"><h1>Cover</h1></section>
      <section class="slide theme-executive layout-hero center"><h1>Thanks</h1></section>
    `;
    const result = validateSlides(html);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Minimum 4 slides'))).toBe(true);
  });

  it('should reject first slide not being hero', () => {
    const html = `
      <section class="slide theme-executive layout-bento-3"><h2>Metrics</h2><div class="bento-grid"><div class="card center"><div class="stat-value">A</div><div class="stat-label">a</div></div><div class="card center"><div class="stat-value">B</div><div class="stat-label">b</div></div><div class="card center"><div class="stat-value">C</div><div class="stat-label">c</div></div></div></section>
      <section class="slide theme-executive layout-timeline"><h2>Timeline</h2><div class="track"><div class="point"><div class="date">Q1</div><div class="text">X</div></div></div></section>
      <section class="slide theme-executive layout-quote"><blockquote>Q</blockquote><div class="attribution">— A</div></section>
      <section class="slide theme-executive layout-hero center"><h1>Thanks</h1></section>
    `;
    const result = validateSlides(html);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('should be layout-hero'))).toBe(true);
  });

  it('should reject last slide not being hero', () => {
    const html = `
      <section class="slide theme-executive layout-hero"><h1>Cover</h1></section>
      <section class="slide theme-executive layout-bento-3"><h2>Metrics</h2><div class="bento-grid"><div class="card center"><div class="stat-value">A</div><div class="stat-label">a</div></div><div class="card center"><div class="stat-value">B</div><div class="stat-label">b</div></div><div class="card center"><div class="stat-value">C</div><div class="stat-label">c</div></div></div></section>
      <section class="slide theme-executive layout-timeline"><h2>Timeline</h2><div class="track"><div class="point"><div class="date">Q1</div><div class="text">X</div></div></div></section>
      <section class="slide theme-executive layout-content"><h2>Summary</h2><ul><li>Point</li></ul></section>
    `;
    const result = validateSlides(html);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('should be layout-hero'))).toBe(true);
  });

  it('should reject slides missing layout class', () => {
    const html = `
      <section class="slide theme-executive"><h1>Missing</h1></section>
      <section class="slide theme-executive"><h2>Layout</h2></section>
      <section class="slide theme-executive"><h2>On all</h2></section>
      <section class="slide theme-executive"><h2>Slides</h2></section>
    `;
    const result = validateSlides(html);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('missing layout class'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════
//  Content JSON Validation (unchanged)
// ═══════════════════════════════════════════════

describe('Content JSON Validation', () => {
  it('valid Content JSON should have meta.title and slides array', () => {
    const valid = {
      meta: { title: 'Test Deck' },
      slides: [
        { type: 'cover', title: 'Hello', date: '2026' },
        { type: 'content', title: 'Key Points', bullets: [{ text: 'Point 1', level: 0 }] },
        { type: 'closing', title: 'Thanks' },
      ],
    };
    expect(valid.meta.title).toBe('Test Deck');
    expect(valid.slides).toHaveLength(3);
    expect(valid.slides[0].type).toBe('cover');
    expect(valid.slides[1].type).toBe('content');
    expect(valid.slides[2].type).toBe('closing');
  });

  it('valid slide types', () => {
    const types = ['cover', 'content', 'section_divider', 'comparison', 'chart', 'closing'];
    expect(types).toHaveLength(6);
  });

  it('chart slide should have required fields', () => {
    const chartSlide = {
      type: 'chart' as const,
      title: 'Revenue Growth',
      chart_type: 'bar' as const,
      categories: ['Q1', 'Q2', 'Q3', 'Q4'],
      series: [{ name: 'Revenue', values: [100, 120, 140, 160] }],
      insight: 'Steady growth across all quarters',
    };
    expect(chartSlide.type).toBe('chart');
    expect(chartSlide.categories).toHaveLength(4);
    expect(chartSlide.series[0].values).toHaveLength(4);
  });

  it('comparison slide should have left and right columns', () => {
    const compSlide = {
      type: 'comparison' as const,
      title: 'Before vs After',
      left: { heading: 'Before', points: ['Manual process', 'Slow turnaround'] },
      right: { heading: 'After', points: ['Automated workflow', 'Fast delivery'] },
    };
    expect(compSlide.left.heading).toBe('Before');
    expect(compSlide.right.heading).toBe('After');
    expect(compSlide.left.points).toHaveLength(2);
    expect(compSlide.right.points).toHaveLength(2);
  });
});

describe('PPTX Service Types', () => {
  it('ContentJson should allow optional fields', () => {
    const minimal: import('../../src/types/pptx.types.js').ContentJson = {
      meta: { title: 'Minimal' },
      slides: [
        { type: 'cover', title: 'Min' },
        { type: 'closing', title: 'End' },
      ],
    };
    expect(minimal.meta.subtitle).toBeUndefined();
    expect(minimal.meta.presenter).toBeUndefined();
    expect(minimal.slides).toHaveLength(2);
  });
});
