/**
 * @fileoverview Document Chunker Utility
 * Splits large markdown documents into manageable chunks for processing
 * while preserving structure and context.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

/**
 * Document Chunker Class
 * Provides multiple strategies for splitting documents into chunks
 */
class DocumentChunker {
  /**
   * Create a chunker instance
   * @param {number} options.maxChunkSize - Max characters per chunk (default: 4000)
   * @param {number} options.overlapSize - Overlap between chunks for context (default: 200)
   */
  constructor(options = {}) {
    this.maxChunkSize = options.maxChunkSize || 4000;
    this.overlapSize = options.overlapSize || 200;
  }

  /**
   * Split document by markdown sections (headers)
   * Sections are separated by # headers
   *
   * @param {string} content - Markdown content to split
   * @returns {Array<{section: string, content: string, startLine: number, endLine: number}>}
   */
  chunkBySection(content) {
    const lines = content.split('\n');
    const chunks = [];
    let currentSection = null;
    let sectionContent = [];
    let startLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect markdown headers (# ## ### etc)
      if (line.match(/^#{1,6}\s+/)) {
        // Save previous section if exists
        if (sectionContent.length > 0) {
          chunks.push({
            section: currentSection,
            content: sectionContent.join('\n'),
            startLine,
            endLine: i - 1,
            lines: sectionContent.length
          });
        }

        // Start new section
        currentSection = line.replace(/^#+\s+/, '').trim();
        sectionContent = [line];
        startLine = i;
      } else {
        sectionContent.push(line);
      }
    }

    // Save final section
    if (sectionContent.length > 0) {
      chunks.push({
        section: currentSection || 'Introduction',
        content: sectionContent.join('\n'),
        startLine,
        endLine: lines.length - 1,
        lines: sectionContent.length
      });
    }

    return chunks;
  }

  /**
   * Split document by fixed character size with paragraph-aware boundaries
   * Tries to break at paragraph boundaries to preserve meaning
   *
   * @param {string} content - Markdown content to split
   * @returns {Array<{content: string, startChar: number, endChar: number, paragraphs: number}>}
   */
  chunkBySize(content) {
    const chunks = [];
    let startChar = 0;

    while (startChar < content.length) {
      let endChar = Math.min(startChar + this.maxChunkSize, content.length);

      // If not at end of document, try to break at paragraph boundary
      if (endChar < content.length) {
        // Look for double newline (paragraph break) within the overlap region
        const searchStart = Math.max(startChar, endChar - this.overlapSize);
        const searchText = content.substring(searchStart, endChar);
        const lastParagraphBreak = searchText.lastIndexOf('\n\n');

        if (lastParagraphBreak !== -1) {
          // Found paragraph break, use it
          endChar = searchStart + lastParagraphBreak;
        }
      }

      const chunk = content.substring(startChar, endChar).trim();

      if (chunk.length > 0) {
        chunks.push({
          content: chunk,
          startChar,
          endChar,
          size: chunk.length,
          paragraphs: (chunk.match(/\n\n/g) || []).length + 1
        });
      }

      // Move to next chunk (with overlap for context)
      startChar = endChar - this.overlapSize;
      if (startChar < endChar) {
        startChar = endChar;
      }
    }

    return chunks;
  }

  /**
   * Split by line count
   * Useful for structured documents with consistent line counts
   *
   * @param {string} content - Markdown content to split
   * @param {number} linesPerChunk - Number of lines per chunk
   * @returns {Array<{content: string, startLine: number, endLine: number}>}
   */
  chunkByLines(content, linesPerChunk = 100) {
    const lines = content.split('\n');
    const chunks = [];

    for (let i = 0; i < lines.length; i += linesPerChunk) {
      const chunkLines = lines.slice(i, Math.min(i + linesPerChunk + 10, lines.length));

      chunks.push({
        content: chunkLines.join('\n'),
        startLine: i,
        endLine: Math.min(i + linesPerChunk + 10, lines.length),
        lines: chunkLines.length
      });
    }

    return chunks;
  }

  /**
   * Intelligently split document based on content analysis
   * Detects structure and uses most appropriate chunking strategy
   *
   * @param {string} content - Markdown content to split
   * @returns {Array<Object>} Chunks using best strategy
   */
  chunkSmart(content) {
    // Count headers to see if document is well-structured
    const headerCount = (content.match(/^#{1,6}\s+/gm) || []).length;
    const totalLines = content.split('\n').length;
    const headerDensity = headerCount / totalLines;

    console.log(`Document analysis: ${totalLines} lines, ${headerCount} headers (density: ${(headerDensity * 100).toFixed(2)}%)`);

    // If well-structured (many headers), use section-based chunking
    if (headerDensity > 0.05) {
      console.log('Using section-based chunking (document is well-structured)');
      const sections = this.chunkBySection(content);

      // Further split large sections by size
      return sections.flatMap(section => {
        if (section.content.length > this.maxChunkSize) {
          console.log(`  Subdividing section "${section.section}" (${section.content.length} chars)`);
          return this.chunkBySize(section.content).map(chunk => ({
            ...chunk,
            parentSection: section.section
          }));
        }
        return [section];
      });
    } else {
      // Otherwise use size-based chunking
      console.log('Using size-based chunking (document lacks clear structure)');
      return this.chunkBySize(content);
    }
  }

  /**
   * Validate chunks have no loss of data
   * Useful for debugging chunking strategy
   *
   * @param {string} original - Original content
   * @param {Array<Object>} chunks - Array of chunks
   * @returns {Object} Validation report
   */
  validateChunks(original, chunks) {
    const reassembled = chunks
      .map(c => c.content)
      .join('\n\n')
      .trim();

    const originalLines = original.split('\n').length;
    const chunkedLines = reassembled.split('\n').length;

    return {
      valid: original.trim() === reassembled,
      originalLength: original.length,
      reassembledLength: reassembled.length,
      originalLines,
      chunkedLines,
      chunkCount: chunks.length,
      avgChunkSize: Math.floor(original.length / chunks.length),
      maxChunkSize: Math.max(...chunks.map(c => c.content.length)),
      minChunkSize: Math.min(...chunks.map(c => c.content.length))
    };
  }
}

module.exports = DocumentChunker;
