'use strict';

/**
 * @fileoverview Tests for the document-processing "convert-document" workflow step.
 * The step converts a single dropped document (docx/pdf/xlsx) to markdown — it
 * backs the wiki drag-and-drop "Design: Convert File" workflow.
 *
 * Bare deps (xlsx, nooblyjs-core) resolve from the root node_modules; the step itself
 * lives in this repo's workflows/ folder.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');

const step = require('../../../workflows/document-processing/steps/convert-document.js');

let tmpDir;

beforeAll(() => {
    // The step calls serviceRegistry.logger(); initialise the registry the same
    // way the worker thread does so logging is available.
    try {
        const serviceRegistry = require('nooblyjs-core');
        const express = require('express');
        serviceRegistry.initialize(express());
    } catch (err) {
        // Already initialised — fine.
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-document-'));
});

afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a small .xlsx fixture and return its path. */
function makeXlsx(name) {
    const src = path.join(tmpDir, name);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
        ['Name', 'Role'],
        ['Stephen', 'Engineer'],
        ['Ada', 'Pioneer']
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'People');
    XLSX.writeFile(wb, src);
    return src;
}

describe('convert-document step', () => {
    test('converts an xlsx file to markdown and writes the output', async () => {
        const sourceDocument = makeXlsx('people.xlsx');
        const outputDocument = path.join(tmpDir, 'people.md');

        const result = await step.run({ settings: { sourceDocument, outputDocument } });

        expect(result.success).toBe(true);
        expect(typeof result.markdown).toBe('string');
        expect(result.markdown).toContain('Stephen');
        expect(result.markdown).toContain('| Name');
        expect(result.outputDocument).toBe(outputDocument);
        expect(fs.existsSync(outputDocument)).toBe(true);
        expect(fs.readFileSync(outputDocument, 'utf8')).toContain('Engineer');
    });

    test('returns a soft failure for an unsupported file type', async () => {
        const sourceDocument = path.join(tmpDir, 'note.foo');
        fs.writeFileSync(sourceDocument, 'not a document');
        const outputDocument = path.join(tmpDir, 'note.md');

        const result = await step.run({ settings: { sourceDocument, outputDocument } });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/unsupported/i);
        expect(fs.existsSync(outputDocument)).toBe(false);
    });

    test('returns a soft failure when settings are missing', async () => {
        const result = await step.run({ settings: {} });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/sourceDocument and outputDocument/i);
    });
});
