import { describe, it, expect } from 'vitest';
import { buildContentBlocks } from '../../src/services/content-builder.service.js';
import { ContentBuildInput, ImageContentBlock } from '../../src/types/upload.types.js';

function makeImageBlock(format: 'png' | 'jpeg' | 'webp' = 'png'): ImageContentBlock {
  return {
    image: {
      format,
      source: { bytes: Buffer.from('fake-image').toString('base64') },
    },
  };
}

describe('buildContentBlocks', () => {
  // Task 6.1: Assembles text blocks followed by image blocks
  it('assembles prompt + documents + images in correct order', () => {
    const input: ContentBuildInput = {
      maskedPrompt: 'Analyze this',
      documentExtractions: [{ text: 'Doc content', filename: 'report.pdf' }],
      imageBlocks: [makeImageBlock()],
    };

    const blocks = buildContentBlocks(input);

    expect(blocks).toHaveLength(3);
    // First: prompt text block
    expect(blocks[0]).toEqual({ text: 'Analyze this' });
    // Second: labeled document text block
    expect(blocks[1]).toEqual({
      text: "Content from uploaded document 'report.pdf':\nDoc content",
    });
    // Third: image block
    expect(blocks[2]).toHaveProperty('image');
  });

  // Task 6.2: Document text labeling
  it('prepends document label with filename before extracted text', () => {
    const input: ContentBuildInput = {
      maskedPrompt: 'Read this',
      documentExtractions: [{ text: 'Hello world', filename: 'contract.docx' }],
      imageBlocks: [],
    };

    const blocks = buildContentBlocks(input);
    expect(blocks[1]).toEqual({
      text: "Content from uploaded document 'contract.docx':\nHello world",
    });
  });

  // Task 6.3: No prompt (documents/images only)
  it('handles no prompt with documents and images', () => {
    const input: ContentBuildInput = {
      documentExtractions: [{ text: 'Some text', filename: 'file.pdf' }],
      imageBlocks: [makeImageBlock()],
    };

    const blocks = buildContentBlocks(input);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      text: "Content from uploaded document 'file.pdf':\nSome text",
    });
    expect(blocks[1]).toHaveProperty('image');
  });

  // Task 6.3: No documents (prompt + images only)
  it('handles prompt + images with no documents', () => {
    const input: ContentBuildInput = {
      maskedPrompt: 'What is in this image?',
      documentExtractions: [],
      imageBlocks: [makeImageBlock('jpeg')],
    };

    const blocks = buildContentBlocks(input);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ text: 'What is in this image?' });
    expect(blocks[1]).toHaveProperty('image');
  });

  // Task 6.3: Multiple documents with separate labels
  it('handles multiple documents each with their own label', () => {
    const input: ContentBuildInput = {
      maskedPrompt: 'Compare these',
      documentExtractions: [
        { text: 'First doc content', filename: 'report-q1.pdf' },
        { text: 'Second doc content', filename: 'report-q2.pdf' },
        { text: 'Third doc content', filename: 'summary.docx' },
      ],
      imageBlocks: [],
    };

    const blocks = buildContentBlocks(input);

    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toEqual({ text: 'Compare these' });
    expect(blocks[1]).toEqual({
      text: "Content from uploaded document 'report-q1.pdf':\nFirst doc content",
    });
    expect(blocks[2]).toEqual({
      text: "Content from uploaded document 'report-q2.pdf':\nSecond doc content",
    });
    expect(blocks[3]).toEqual({
      text: "Content from uploaded document 'summary.docx':\nThird doc content",
    });
  });

  // Empty request rejection
  it('throws error when no prompt and no files are provided', () => {
    const input: ContentBuildInput = {
      documentExtractions: [],
      imageBlocks: [],
    };

    expect(() => buildContentBlocks(input)).toThrow(
      'At least one input is required: text prompt or file attachment'
    );
  });

  // Skip documents with empty text
  it('skips documents with empty extracted text', () => {
    const input: ContentBuildInput = {
      maskedPrompt: 'Analyze',
      documentExtractions: [
        { text: '', filename: 'empty.pdf' },
        { text: 'Has content', filename: 'real.pdf' },
      ],
      imageBlocks: [],
    };

    const blocks = buildContentBlocks(input);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ text: 'Analyze' });
    expect(blocks[1]).toEqual({
      text: "Content from uploaded document 'real.pdf':\nHas content",
    });
  });

  // Only images, no prompt or documents
  it('handles images only (no prompt, no documents)', () => {
    const input: ContentBuildInput = {
      documentExtractions: [],
      imageBlocks: [makeImageBlock('png'), makeImageBlock('webp')],
    };

    const blocks = buildContentBlocks(input);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toHaveProperty('image');
    expect(blocks[1]).toHaveProperty('image');
  });
});
