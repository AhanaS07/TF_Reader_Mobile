// src/model/batchItems.test.ts
import { CatalogueError } from '@model/errors';
import { normalizeBatchItemsResponse } from '@model/batchItems';

describe('normalizeBatchItemsResponse', () => {
  it('normalizes a well-formed batch response', () => {
    expect(
      normalizeBatchItemsResponse({
        items: [
          {
            id: 'item_42',
            title: 'Rights for Robots',
            authors: ['Joshua C. Gellers'],
            coverUrl: 'https://cdn.tf/covers/item_42.jpg',
            isbn: '9780367211745',
            contentType: 'PDF',
            accessTier: 'ELITE',
            totalCopies: 2,
            hasSearchIndex: true,
          },
        ],
        notFound: ['item_bogus'],
        denied: ['item_77'],
      }),
    ).toEqual({
      items: [
        {
          id: 'item_42',
          title: 'Rights for Robots',
          authors: ['Joshua C. Gellers'],
          coverUrl: 'https://cdn.tf/covers/item_42.jpg',
          isbn: '9780367211745',
          format: 'PDF',
          accessTier: 'ELITE',
          totalCopies: 2,
          hasSearchIndex: true,
        },
      ],
      notFound: ['item_bogus'],
      denied: ['item_77'],
    });
  });

  it('defaults hasSearchIndex to false when the wire omits it', () => {
    const [item] = normalizeBatchItemsResponse({
      items: [{ id: 'item_oa1', title: 'Coastal Wetlands', contentType: 'EPUB', accessTier: 'OPEN_ACCESS' }],
      notFound: [],
      denied: [],
    }).items;

    expect(item.hasSearchIndex).toBe(false);
  });

  it('omits authors, coverUrl, isbn and totalCopies entirely when the wire has none', () => {
    const [item] = normalizeBatchItemsResponse({
      items: [{ id: 'item_oa1', title: 'Coastal Wetlands', contentType: 'EPUB', accessTier: 'OPEN_ACCESS' }],
      notFound: [],
      denied: [],
    }).items;

    expect(Object.keys(item)).not.toContain('authors');
    expect(Object.keys(item)).not.toContain('coverUrl');
    expect(Object.keys(item)).not.toContain('isbn');
    expect(Object.keys(item)).not.toContain('totalCopies');
  });

  it('treats a null coverUrl, isbn or totalCopies as absent, not a value to pass through', () => {
    const [item] = normalizeBatchItemsResponse({
      items: [
        {
          id: 'item_oa1',
          title: 'Coastal Wetlands',
          contentType: 'EPUB',
          accessTier: 'OPEN_ACCESS',
          coverUrl: null,
          isbn: null,
          totalCopies: null,
        },
      ],
      notFound: [],
      denied: [],
    }).items;

    expect(item.coverUrl).toBeUndefined();
    expect(item.isbn).toBeUndefined();
    expect(item.totalCopies).toBeUndefined();
  });

  it('rejects a response with no items array', () => {
    expect(() => normalizeBatchItemsResponse({ notFound: [], denied: [] })).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });

  it('rejects a response with no notFound array', () => {
    expect(() => normalizeBatchItemsResponse({ items: [], denied: [] })).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });

  it('rejects a response with no denied array', () => {
    expect(() => normalizeBatchItemsResponse({ items: [], notFound: [] })).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });

  it.each(['id', 'title', 'contentType', 'accessTier'])('rejects an item missing %s', (field) => {
    const complete: Record<string, unknown> = {
      id: 'item_42',
      title: 'Rights for Robots',
      contentType: 'PDF',
      accessTier: 'ELITE',
    };
    delete complete[field];

    expect(() => normalizeBatchItemsResponse({ items: [complete], notFound: [], denied: [] })).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });

  it('rejects an item with an unrecognised contentType', () => {
    expect(() =>
      normalizeBatchItemsResponse({
        items: [{ id: 'item_42', title: 'Rights for Robots', contentType: 'HTML', accessTier: 'ELITE' }],
        notFound: [],
        denied: [],
      }),
    ).toThrow(expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }));
  });

  it('rejects an item with an unrecognised accessTier', () => {
    expect(() =>
      normalizeBatchItemsResponse({
        items: [{ id: 'item_42', title: 'Rights for Robots', contentType: 'PDF', accessTier: 'FREE' }],
        notFound: [],
        denied: [],
      }),
    ).toThrow(expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }));
  });
});
