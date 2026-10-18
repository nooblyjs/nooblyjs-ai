/**
 * @fileoverview Document Cleaner Service
 * Uses the configured AI expert to remove headers, footers, cover pages, and
 * metadata from markdown documents. Documents are processed in manageable
 * chunks so large files stay within the model's token budget, and embedded
 * base64 images are extracted before cleaning and restored afterwards.
 *
 * @author Digital Technologies Team
 * @version 3.0.0
 */

'use strict';
const fs = require('node:fs').promises;
const DocumentChunker = require('./documentChunker');
const wikiBlocks = require('../../common/content/wikiBlocks.js');
const { prompts } = require('../../common/prompts/prompts');

/**
 * Document Cleaner Class
 * Processes markdown files by chunking them, cleaning each chunk via the AI
 * expert, and reassembling the result.
 *
 * @constructor - Receives settings with AI expert
 * @method validateFile - Verify file exists and is readable
 * @method cleanDocument - Main cleaning logic with chunking
 * @method process - Main entry point
 */
class DocumentCleaner {

  /**
   * Constructor - Receive settings
   *
   * @param {Object} settings - Configuration settings
   * @param {Object} settings.expert - AI expert instance for document analysis (exposes prompt(systemContent, userContent))
   * @param {number} [settings.maxChunkSize] - Max chunk size in characters (default: 4000)
   * @param {string} [settings.provider] - Provider name of the expert, used only for result metadata (set by the step wiring the expert)
   * @param {string} [settings.deployment] - Model name, used only for logging and result metadata
   * @param {Object} [settings.prompts] - Prompt library (see common/prompts/prompts.js).
   *   Defaults to the shared library resolved off APP_BASE_DIR.
   */
  constructor(settings) {
    this.settings = settings;
    // The cleaning instructions live in the platform's prompt library
    // (datasources → AI → Prompts, key "document-cleaning") so they can be tuned
    // without a code change; the step binds this to its own appBaseDir.
    this.prompts = settings.prompts || prompts;
    this.chunker = new DocumentChunker({
      maxChunkSize: settings.maxChunkSize || 4000,
      overlapSize: 200
    });
  }

  /**
   * Validate file exists and is readable
   * @param {string} filePath - Path to file
   * @returns {Promise<boolean>}
   */
  async validateFile(filePath) {
    try {
      await fs.stat(filePath);
      return true;
    } catch (error) {
      throw new Error(`File not found or not readable: ${filePath}`);
    }
  }

  /**
   * Extract embedded base64 data-URI images, swapping each for a short
   * placeholder reference.
   *
   * Base64 image payloads are huge — often 200KB+ for a single diagram — and
   * are meaningless to a text-cleaning LLM. Sending them wastes tokens and can
   * exhaust the model's completion budget, causing empty/truncated responses.
   * We swap them for lightweight placeholders so the cleaner preserves each
   * image's position, then restore the originals afterwards via restoreImages().
   *
   * (Front-page/header logo images are already dropped upstream by docxToJson,
   * which skips any image appearing before the first heading.)
   *
   * @param {string} content - Markdown content
   * @returns {{ content: string, images: Array<{placeholder: string, markdown: string}> }}
   */
  extractImages(content) {
    const images = [];
    const stripped = content.replace(
      /!\[[^\]]*\]\(data:[^;]+;base64,[^)]*\)/g,
      (match) => {
        const placeholder = `images/__img_${images.length + 1}__.png`;
        images.push({ placeholder, markdown: match });
        const altMatch = match.match(/^!\[([^\]]*)\]/);
        const alt = altMatch ? altMatch[1] : '';
        return `![${alt || 'image'}](${placeholder})`;
      }
    );
    return { content: stripped, images };
  }

  /**
   * Restore previously-extracted images back into cleaned content.
   * Matches each placeholder regardless of any alt-text the LLM may have
   * altered. Images the cleaner dropped entirely are reported as `dropped`.
   *
   * @param {string} content - Cleaned markdown containing image placeholders
   * @param {Array<{placeholder: string, markdown: string}>} images - Extracted images
   * @returns {{ content: string, restored: number, dropped: number }}
   */
  restoreImages(content, images) {
    let result = content;
    let restored = 0;
    let dropped = 0;

    for (const img of images) {
      const escaped = img.placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`!\\[[^\\]]*\\]\\(${escaped}\\)`);

      if (pattern.test(result)) {
        result = result.replace(pattern, () => img.markdown);
        restored++;
      } else {
        dropped++;
      }
    }

    return { content: result, restored, dropped };
  }

  /**
   * Calculate statistics about the cleaning process
   * @param {string} originalContent - Original markdown content
   * @param {string} cleanedContent - Cleaned markdown content
   * @returns {Object} Statistics object
   */
  calculateStatistics(originalContent, cleanedContent) {
    const originalLines = originalContent.split('\n').length;
    const cleanedLines = cleanedContent.split('\n').length;
    const linesRemoved = originalLines - cleanedLines;
    const percentageReduced = ((linesRemoved / originalLines) * 100).toFixed(2);

    return {
      originalSize: originalContent.length,
      cleanedSize: cleanedContent.length,
      originalLines,
      cleanedLines,
      linesRemoved,
      percentageReduced: `${percentageReduced}%`,
      bytesRemoved: originalContent.length - cleanedContent.length
    };
  }

  /**
   * Clean a single chunk using AI
   * @param {string} chunkContent - Content chunk to clean
   * @param {number} chunkIndex - Index of chunk for logging
   * @param {number} totalChunks - Total number of chunks
   * @returns {Promise<string>} Cleaned chunk content
   */
  async cleanChunk(chunkContent, chunkIndex, totalChunks) {
    const systemPrompt = this.prompts.get('document-cleaning');

    const userPrompt = `Please clean and extract the main content from this markdown section [Chunk ${chunkIndex + 1}/${totalChunks}], removing all headers, footers, cover pages, and metadata:\n\n${chunkContent}`;

    console.log(`  Cleaning chunk ${chunkIndex + 1}/${totalChunks} (${chunkContent.length} chars)...`);

    try {
      let cleanedContent = await this.settings.expert.prompt(systemPrompt, userPrompt);

      if (!cleanedContent || cleanedContent.trim().length === 0) {
        console.warn(`  ⚠️ Chunk ${chunkIndex + 1} returned empty, keeping original`);
        return chunkContent;
      }

      // Clean up markdown artifacts from response
      cleanedContent = cleanedContent
        .replace(/^```markdown\n?/, '')
        .replace(/\n?```$/, '')
        .trim();

      console.log(`  ✓ Chunk ${chunkIndex + 1} cleaned: ${chunkContent.length} → ${cleanedContent.length} chars`);
      return cleanedContent;

    } catch (error) {
      console.error(`  ✗ Error cleaning chunk ${chunkIndex + 1}: ${error.message}`);
      console.warn(`  Returning original chunk content`);
      return chunkContent;
    }
  }

  /**
   * Clean document using AI with chunking strategy
   * @param {string} filePath - Path to markdown file
   * @returns {Promise<Object>} Result object with statistics
   */
  async cleanDocument(filePath) {
    try {
      // Validate file
      await this.validateFile(filePath);

      console.log(`\nReading markdown file: ${filePath}`);
      const originalContent = await fs.readFile(filePath, 'utf-8');

      if (!originalContent || originalContent.trim().length === 0) {
        throw new Error('Markdown file is empty');
      }

      console.log(`File size: ${originalContent.length} bytes (${originalContent.split('\n').length} lines)`);

      // Extract embedded base64 images before chunking — they bloat the payload
      // and are not text the cleaner can process. They are restored afterwards.
      const { content: workingContent, images } = this.extractImages(originalContent);
      if (images.length > 0) {
        console.log(`Extracted ${images.length} embedded image(s) for restoration after cleaning ` +
          `(${originalContent.length} → ${workingContent.length} bytes)`);
      }

      // Chunk the document intelligently
      console.log('\nAnalyzing document structure for optimal chunking...');
      const chunks = this.chunker.chunkSmart(workingContent);

      console.log(`\n✓ Document split into ${chunks.length} chunks:`);
      chunks.forEach((chunk, idx) => {
        const label = chunk.section || chunk.parentSection || `Chunk ${idx + 1}`;
        console.log(`  ${idx + 1}. ${label} (${chunk.content.length} chars)`);
      });

      // Validate chunks against the working (image-stripped) content
      const validation = this.chunker.validateChunks(workingContent, chunks);
      console.log(`\nChunk validation: ${validation.valid ? '✓ Valid' : '✗ Invalid'}`);
      console.log(`  Average chunk size: ${validation.avgChunkSize} chars`);
      console.log(`  Max chunk size: ${validation.maxChunkSize} chars`);

      // Process each chunk
      console.log('\nCleaning document chunks...');
      const cleanedChunks = [];

      for (let i = 0; i < chunks.length; i++) {
        const cleaned = await this.cleanChunk(chunks[i].content, i, chunks.length);
        cleanedChunks.push(cleaned);
      }

      // Reassemble cleaned chunks
      console.log('\nReassembling cleaned chunks...');
      let cleanedContent = cleanedChunks
        .map(chunk => chunk.trim())
        .filter(chunk => chunk.length > 0)
        .join('\n\n')
        .trim();

      if (!cleanedContent || cleanedContent.length === 0) {
        throw new Error('No content remained after cleaning');
      }

      console.log(`✓ Reassembly complete: ${cleanedContent.length} bytes`);

      // Restore the extracted images into the cleaned content
      if (images.length > 0) {
        const restoration = this.restoreImages(cleanedContent, images);
        cleanedContent = restoration.content;
        console.log(`Restored ${restoration.restored}/${images.length} image(s)` +
          (restoration.dropped > 0
            ? ` — ${restoration.dropped} placeholder(s) were dropped by the cleaner`
            : ''));
      }

      // Write cleaned content back to file. The cleaner can strip the wiki's
      // blocks (annotations/comments/…); writeMarkdownPreserving reads the
      // original (still on disk here) and carries them back into the result.
      console.log(`\nWriting cleaned document to: ${filePath}`);
      wikiBlocks.writeMarkdownPreserving(filePath, cleanedContent);

      // Calculate and return statistics
      const statistics = this.calculateStatistics(originalContent, cleanedContent);

      return {
        success: true,
        message: 'Document cleaned successfully',
        filePath,
        statistics,
        chunkingStrategy: {
          totalChunks: chunks.length,
          avgChunkSize: validation.avgChunkSize,
          maxChunkSize: validation.maxChunkSize
        },
        provider: this.settings.provider || 'unknown',
        deploymentName: this.settings.deployment,
        processedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('Error in cleanDocument:', error.message);
      return {
        success: false,
        error: error.message,
        filePath,
        processedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Process a single markdown file
   * Main entry point
   *
   * @param {string} markdownFilePath - Path to markdown file to clean
   * @returns {Promise<Object>} Result object
   */
  async process(markdownFilePath) {
    try {
      // Validate settings
      if (!this.settings.expert) {
        throw new Error('AI expert not provided in settings');
      }

      if (!markdownFilePath) {
        throw new Error('Missing required parameter: markdownFilePath');
      }

      console.log('='.repeat(70));
      console.log('Document Cleaner Service');
      console.log('='.repeat(70));
      console.log(`Target file: ${markdownFilePath}`);
      console.log(`Deployment: ${this.settings.deployment}`);
      console.log(`Max chunk size: ${this.settings.maxChunkSize || 4000} chars`);

      // Clean the document
      const result = await this.cleanDocument(markdownFilePath);

      if (result.success) {
        console.log('\n✓ Document cleaned successfully');
        console.log(`Statistics:`);
        console.log(`  Original Size: ${result.statistics.originalSize} bytes`);
        console.log(`  Cleaned Size: ${result.statistics.cleanedSize} bytes`);
        console.log(`  Lines Removed: ${result.statistics.linesRemoved}`);
        console.log(`  Percentage Reduced: ${result.statistics.percentageReduced}`);
        console.log(`\nChunking Strategy:`);
        console.log(`  Total Chunks: ${result.chunkingStrategy.totalChunks}`);
        console.log(`  Avg Chunk Size: ${result.chunkingStrategy.avgChunkSize} chars`);
        console.log(`  Max Chunk Size: ${result.chunkingStrategy.maxChunkSize} chars`);
      } else {
        console.log('\n✗ Document cleaning failed');
        console.log(`Error: ${result.error}`);
      }

      console.log('='.repeat(70));
      return result;

    } catch (error) {
      console.error('Fatal error in process:', error.message);
      return {
        success: false,
        error: error.message,
        processedAt: new Date().toISOString()
      };
    }
  }
}

module.exports = DocumentCleaner;
