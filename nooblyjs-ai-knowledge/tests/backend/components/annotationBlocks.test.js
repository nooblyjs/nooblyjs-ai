'use strict';

const A = require('../../../src/wiki/components/annotationBlocks');

const DOC = `# Pricing Doc

Some intro about Akamai Identity Cloud and pricing.

## Pricing

| Integration | Source | Destination |
| --- | --- | --- |
| Acme Express eCommerce | SAP | Akamai |
| OnDemand | SAP | Akamai |

## Notes

Final paragraph here.
`;

describe('annotationBlocks — target parse/build', () => {
    test('round-trips a row target', () => {
        const raw = 'row | table="Integrations" | match="Acme Express eCommerce"';
        const t = A.parseTarget(raw);
        expect(t).toEqual({ kind: 'row', table: 'Integrations', match: 'Acme Express eCommerce' });
        expect(A.buildTarget(t)).toBe(raw);
    });

    test('parses a text target with context', () => {
        const t = A.parseTarget('text | quote="Akamai Identity Cloud" | before="about "');
        expect(t.kind).toBe('text');
        expect(t.quote).toBe('Akamai Identity Cloud');
        expect(t.before).toBe('about ');
    });
});

describe('annotationBlocks — block parse/build round-trip', () => {
    test('build then parse yields the same fields', () => {
        const block = A.buildAnnotationBlock({
            target: { kind: 'text', quote: 'Akamai' },
            annotation: 'Multi\nline note',
            annotator: 'a@b.com',
            date: '2026-05-30 11:00',
            id: 'abc123'
        });
        const [entry] = A.parseAnnotationBlocks(block);
        expect(entry.id).toBe('abc123');
        expect(entry.annotator).toBe('a@b.com');
        expect(entry.annotation).toBe('Multi\nline note');
        expect(entry.target).toEqual({ kind: 'text', quote: 'Akamai' });
    });
});

describe('annotationBlocks — resolveTarget', () => {
    test('text target resolves to end of its paragraph', () => {
        const at = A.resolveTarget(DOC, { kind: 'text', quote: 'Akamai Identity Cloud' });
        expect(at).toBeGreaterThan(-1);
        expect(DOC.slice(0, at)).toContain('Akamai Identity Cloud');
        // insertion point is the paragraph break, not mid-sentence
        expect(DOC[at]).toBe('\n');
    });

    test('section target resolves just after the heading', () => {
        const at = A.resolveTarget(DOC, { kind: 'section', heading: 'Pricing' });
        expect(DOC.slice(0, at).trimEnd().endsWith('## Pricing')).toBe(true);
    });

    test('row target resolves after the whole table', () => {
        const at = A.resolveTarget(DOC, { kind: 'row', match: 'Acme Express eCommerce' });
        // everything before the insertion point includes the table; what follows is the next section
        expect(DOC.slice(0, at)).toContain('| OnDemand | SAP | Akamai |');
        expect(DOC.slice(at)).toContain('## Notes');
    });

    test('cell target resolves after the table, matched by row key + cell text', () => {
        const at = A.resolveTarget(DOC, { kind: 'cell', row: 'Acme Express eCommerce', text: 'SAP' });
        expect(at).toBeGreaterThan(-1);
        expect(DOC.slice(0, at)).toContain('| Acme Express eCommerce | SAP | Akamai |');
        expect(DOC.slice(at)).toContain('## Notes');
    });

    test('cell target returns -1 when the cell text is absent', () => {
        expect(A.resolveTarget(DOC, { kind: 'cell', row: 'Acme Express eCommerce', text: 'Nope' })).toBe(-1);
    });

    test('missing target returns -1', () => {
        expect(A.resolveTarget(DOC, { kind: 'text', quote: 'nonexistent' })).toBe(-1);
    });
});

describe('annotationBlocks — insert / remove', () => {
    test('insert places block adjacent to the target and parses back', () => {
        const { content, resolved, id } = A.insertAnnotation(DOC, {
            target: { kind: 'section', heading: 'Pricing' },
            annotation: 'Review these prices',
            annotator: 'a@b.com'
        });
        expect(resolved).toBe(true);
        const blocks = A.parseAnnotationBlocks(content);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].id).toBe(id);

        const removed = A.removeAnnotationById(content, id);
        expect(A.parseAnnotationBlocks(removed)).toHaveLength(0);
        expect(removed).not.toContain('```annotation');
    });
});

describe('annotationBlocks — preserveAnnotations', () => {
    test('re-anchors a surviving annotation into regenerated content', () => {
        const withAnno = A.insertAnnotation(DOC, {
            target: { kind: 'row', match: 'Acme Express eCommerce' },
            annotation: 'Stale price',
            annotator: 'a@b.com',
            id: 'keep1'
        }).content;

        // Regenerated doc: same row exists, but no annotation block.
        const regenerated = DOC.replace('Final paragraph here.', 'Updated final paragraph.');
        const { content, reanchored, orphaned } = A.preserveAnnotations(withAnno, regenerated);

        expect(orphaned).toHaveLength(0);
        expect(reanchored.map(e => e.id)).toContain('keep1');
        expect(A.parseAnnotationBlocks(content).map(e => e.id)).toContain('keep1');
        expect(content).toContain('Updated final paragraph.');
    });

    test('is a no-op when the block already exists (Id dedupe)', () => {
        const withAnno = A.insertAnnotation(DOC, {
            target: { kind: 'section', heading: 'Pricing' },
            annotation: 'note', annotator: 'a@b.com', id: 'dupe1'
        }).content;

        // "Regenerated" content is the same file that already has the block.
        const { content, reanchored, orphaned } = A.preserveAnnotations(withAnno, withAnno);
        expect(reanchored).toHaveLength(0);
        expect(orphaned).toHaveLength(0);
        expect(A.parseAnnotationBlocks(content)).toHaveLength(1);
    });

    test('parks orphans when the target disappears', () => {
        const withAnno = A.insertAnnotation(DOC, {
            target: { kind: 'row', match: 'Acme Express eCommerce' },
            annotation: 'Stale price', annotator: 'a@b.com', id: 'orphan1'
        }).content;

        // Regenerated doc no longer contains that row.
        const regenerated = DOC.replace('| Acme Express eCommerce | SAP | Akamai |\n', '');
        const { content, orphaned } = A.preserveAnnotations(withAnno, regenerated);

        expect(orphaned.map(e => e.id)).toContain('orphan1');
        expect(content).toContain(A.ORPHAN_HEADING);
        expect(A.parseAnnotationBlocks(content).map(e => e.id)).toContain('orphan1');
    });
});
