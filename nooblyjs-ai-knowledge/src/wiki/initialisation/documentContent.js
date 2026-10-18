/**
 * @fileoverview Default document content for wiki initialization
 * Contains markdown content for sample documents
 * 
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-08-25
 */

'use strict';

const defaultDocumentContent = {};

/**
 * Initialize document content files in filing service
 */
async function initializeDocumentFiles(services) {
  const { filing, logger } = services;
  
  try {
    for (const [docId, content] of Object.entries(defaultDocumentContent)) {
      const filePath = `documents/${docId}.md`;
      
      try {
        // Check if file already exists
        await filing.read(filePath);
        logger.info(`Document file ${filePath} already exists, skipping`);
      } catch (error) {
        // File doesn't exist, create it
        await filing.create(filePath, content);
        logger.info(`Created document file: ${filePath}`);
      }
    }
  } catch (error) {
    logger.error('Error initializing document files:', error);
    throw error;
  }
}

module.exports = {
  defaultDocumentContent,
  initializeDocumentFiles
};