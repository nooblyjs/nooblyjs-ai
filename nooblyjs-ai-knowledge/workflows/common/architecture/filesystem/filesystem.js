/**
 * @fileoverview Filesystem utilites
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const glob = require("glob");
const wikiBlocks = require('../../content/wikiBlocks.js');

/**
 * Normalise a filesystem PATH (not a single name segment) so values that arrive
 * with Windows-style separators or stray CR/LF — e.g. a *folder setting pasted
 * from Windows or saved with CRLF line endings — don't create literal-backslash
 * / trailing-carriage-return folders on POSIX systems.
 *
 * NOTE: deliberately separate from {@link sanitizeFilename}, which sanitises a
 * single name segment (and would destroy real `/` separators).
 *
 * @param {string} p
 * @returns {string}
 */
function normalizePath(p) {
    return String(p == null ? '' : p)
        .replace(/[\r\n]+/g, '')   // strip stray CR/LF (e.g. CRLF .env values)
        .replace(/\\/g, '/')        // Windows-style separators -> POSIX
        .replace(/\/{2,}/g, '/')    // collapse duplicate slashes
        .trim();
}

/**
 * Write a file
 *
 * @async
 * @function writeFile
 * @param {string} filename - The file to read
 * @param {string} content - The ARIS server to call
 */
function writeJSONFile(filename, jsonData) {
    filename = normalizePath(filename);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    let content = JSON.stringify(jsonData, null, 2);
    content = content.replace("\"{", '{').replace("}\"", '}').replace(/\\"/g, '"').replace(/\\\\"/g, '\\"'); 
    fs.writeFileSync(filename, content);
}

/**
 * Read a file
 * 
 * @async
 * @function readFile
 * @param {Object} filename - The file to read
 * @returns {object>} The JSON result
 */
function readJSONFile(filename) {
    filename = normalizePath(filename);
    let json= {};
    let data = fs.readFileSync(filename, 'utf8');
    try {
        json =  JSON.parse(fs.readFileSync(filename, 'utf8'))
    } catch (error) {
        console.log("Error converting to json " + filename);
    }
    return json
}

/**
 * Write a file
 * 
 * @async
 * @function writeFile
 * @param {string} filename - The file to read
 * @param {string} content - The ARIS server to call
 */
function writeFile(filename, content) {
    filename = normalizePath(filename);
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.md' || ext === '.markdown') {
        // Updating an existing wiki page — carry over the user's blocks
        // (annotations, comments, likes, links, document metadata) instead of
        // clobbering them. No-op for brand-new files or files without blocks.
        wikiBlocks.writeMarkdownPreserving(filename, content);
        return;
    }
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content, null, 2);
}

/**
 * Create Folder
 * 
 * @async
 * @param {string} folder - The file to read
 */
function createFolder(foldername) {
    fs.mkdirSync(normalizePath(foldername), { recursive: true });
}

/**
 * Read a file
 * 
 * @async
 * @function readFile
 * @param {Object} filename - The file to read
 * @returns {object>} The file content
 */
function readFile(filename) {
    return fs.readFileSync(normalizePath(filename), 'utf8');
}

/**
 * Test if a file exists
 * 
 * @async
 * @function readFile
 * @param {Object} filename - The file to read
 * @returns {object>} The JSON result
 */
function fileExists(filename) {
    return fs.existsSync(normalizePath(filename));
}

/**
 * Sanitise a file name
 * @param {string} filename
 * @returns
 */
function sanitizeFilename(filename) {
    return String(filename == null ? '' : filename)
        .replace(/[\\/:*?"<>|]/g, ' ')   // invalid file/folder chars -> space
        .replace(/(\r\n|\n|\r)/gm, '')    // strip stray CR/LF
        .replace(/\s{2,}/g, ' ')          // collapse the runs of whitespace a replacement may leave
        .trim();                          // no leading or trailing space
}

/**
 * Return a file's last-modified time, or null when the file does not exist.
 *
 * @function fileModifiedTime
 * @param {string} filename - The file to stat
 * @returns {Date|null} The mtime, or null if the file is missing
 */
function fileModifiedTime(filename) {
    filename = normalizePath(filename);
    if (!fs.existsSync(filename)) {
        return null;
    }
    return fs.statSync(filename).mtime;
}

module.exports = {
    normalizePath,
    writeJSONFile,
    readJSONFile,
    writeFile,
    readFile,
    fileExists,
    fileModifiedTime,
    sanitizeFilename,
    createFolder
};
