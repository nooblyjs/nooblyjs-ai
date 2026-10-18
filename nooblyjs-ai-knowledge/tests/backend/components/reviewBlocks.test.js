'use strict';

const R = require('../../../src/wiki/components/reviewBlocks');

const DOC = `# Pricing Doc

Some intro about pricing.

## Notes

Final paragraph here.
`;

const REQ = 'srbooysen@example.com';
const REV = 'sdupreez@example.com';

describe('reviewBlocks — entry parse/build round-trip', () => {
    test('build then parse yields the same fields', () => {
        const text = R.buildReviewEntry({
            id: 'abc123', review: 'inprogress', requested: REQ, reviewer: REV,
            annotations: 2, stars: '', comment: '', startdate: '2026-06-09', enddate: ''
        });
        const e = R.parseReviewEntry(text);
        expect(e.id).toBe('abc123');
        expect(e.review).toBe('inprogress');
        expect(e.requested).toBe(REQ);
        expect(e.reviewer).toBe(REV);
        expect(e.annotations).toBe('2');
        expect(e.startdate).toBe('2026-06-09');
        expect(e.enddate).toBe('');
    });

    test('collapses newlines in comment to a single line', () => {
        const text = R.buildReviewEntry({ id: 'x', reviewer: REV, comment: 'Well\ndone' });
        expect(text).toContain('comment: Well done');
        expect(R.parseReviewEntry(text).comment).toBe('Well done');
    });

    test('fills in id and startdate when omitted', () => {
        const e = R.parseReviewEntry(R.buildReviewEntry({ reviewer: REV }));
        expect(e.id).toMatch(/\w+/);
        expect(e.startdate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

describe('reviewBlocks — block parse/build with multiple entries', () => {
    const block = R.buildReviewsBlock([
        { id: 'one', review: 'inprogress', requested: REQ, reviewer: REV, startdate: '2026-06-09' },
        { id: 'two', review: 'complete', requested: REQ, reviewer: 'akader@example.com', stars: 5, comment: 'Well done', startdate: '2026-06-01', enddate: '2026-06-01' }
    ]);

    test('renders a single fenced reviews block', () => {
        expect((block.match(/```reviews/g) || []).length).toBe(1);
    });

    test('parses every entry back out, in order', () => {
        const entries = R.parseReviews(block);
        expect(entries.map(e => e.id)).toEqual(['one', 'two']);
        expect(entries[1].stars).toBe('5');
        expect(entries[1].review).toBe('complete');
    });

    test('parseReviews on a doc with no block yields []', () => {
        expect(R.parseReviews(DOC)).toEqual([]);
    });
});

describe('reviewBlocks — add / find / update / remove', () => {
    test('addReview appends a block to a plain doc', () => {
        const { content, id } = R.addReview(DOC, { requested: REQ, reviewer: REV });
        expect(content).toContain('```reviews');
        expect(content).toContain('Final paragraph here.');
        const found = R.findReviewById(content, id);
        expect(found).not.toBeNull();
        expect(found.reviewer).toBe(REV);
        expect(found.review).toBe('inprogress');
    });

    test('addReview appends a second entry to an existing block', () => {
        const first = R.addReview(DOC, { requested: REQ, reviewer: REV }).content;
        const second = R.addReview(first, { requested: REQ, reviewer: 'akader@example.com' });
        expect(R.parseReviews(second.content)).toHaveLength(1 + 1);
        expect((second.content.match(/```reviews/g) || []).length).toBe(1);
    });

    test('updateReviewById completes a review', () => {
        const { content, id } = R.addReview(DOC, { requested: REQ, reviewer: REV });
        const done = R.updateReviewById(content, id, {
            review: 'complete', stars: 5, comment: 'Looks good', enddate: '2026-06-10'
        });
        const e = R.findReviewById(done, id);
        expect(e.review).toBe('complete');
        expect(e.stars).toBe('5');
        expect(e.comment).toBe('Looks good');
        expect(e.enddate).toBe('2026-06-10');
    });

    test('updateReviewById returns null for an unknown id', () => {
        const { content } = R.addReview(DOC, { requested: REQ, reviewer: REV });
        expect(R.updateReviewById(content, 'nope', { stars: 1 })).toBeNull();
    });

    test('removeReviewById drops the entry and the block when empty', () => {
        const { content, id } = R.addReview(DOC, { requested: REQ, reviewer: REV });
        const removed = R.removeReviewById(content, id);
        expect(R.parseReviews(removed)).toHaveLength(0);
        expect(removed).not.toContain('```reviews');
    });
});

describe('reviewBlocks — queries', () => {
    test('isUnderReview reflects any in-progress entry', () => {
        const { content, id } = R.addReview(DOC, { requested: REQ, reviewer: REV });
        expect(R.isUnderReview(content)).toBe(true);
        const done = R.updateReviewById(content, id, { review: 'complete', enddate: '2026-06-10' });
        expect(R.isUnderReview(done)).toBe(false);
    });

    test('activeReviewFor matches the reviewer case-insensitively', () => {
        const { content } = R.addReview(DOC, { requested: REQ, reviewer: REV });
        expect(R.activeReviewFor(content, REV.toUpperCase())).not.toBeNull();
        expect(R.activeReviewFor(content, 'someone@else.com')).toBeNull();
    });

    test('incrementAnnotationCount bumps the reviewer in-progress entry', () => {
        const { content, id } = R.addReview(DOC, { requested: REQ, reviewer: REV });
        const once = R.incrementAnnotationCount(content, REV);
        expect(R.findReviewById(once, id).annotations).toBe('1');
        const twice = R.incrementAnnotationCount(once, REV);
        expect(R.findReviewById(twice, id).annotations).toBe('2');
    });

    test('incrementAnnotationCount is a no-op for a reviewer with no active review', () => {
        const { content } = R.addReview(DOC, { requested: REQ, reviewer: REV });
        expect(R.incrementAnnotationCount(content, 'nobody@x.com')).toBe(content);
    });
});

describe('reviewBlocks — preserveReviews', () => {
    test('re-appends the block when a wholesale rewrite dropped it', () => {
        const withReviews = R.addReview(DOC, { requested: REQ, reviewer: REV, id: 'keep1' }).content;
        const regenerated = DOC.replace('Final paragraph here.', 'Updated paragraph.');
        const { content, carried } = R.preserveReviews(withReviews, regenerated);
        expect(carried).toBe(1);
        expect(R.parseReviews(content).map(e => e.id)).toContain('keep1');
        expect(content).toContain('Updated paragraph.');
    });

    test('keeps the new block when the rewrite already has one', () => {
        const withReviews = R.addReview(DOC, { requested: REQ, reviewer: REV }).content;
        const { content, carried } = R.preserveReviews(withReviews, withReviews);
        expect(carried).toBe(0);
        expect((content.match(/```reviews/g) || []).length).toBe(1);
    });
});
