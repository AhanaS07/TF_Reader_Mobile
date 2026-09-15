// Owner: Reader (Ahana).
//
// Pins the one property that actually matters for the highlight seam: two owners never produce the
// same epub.js annotation `type` or CSS class, since `Annotations.remove` is keyed on
// `cfiRange + type` and a collision there would let one owner's removal wipe another's paint.

import { annotationClassName, annotationType } from '@/features/reader/webview/src/highlightNaming';

describe('annotationType', () => {
  it('namespaces by owner', () => {
    expect(annotationType('tts')).toBe('tf-hl-tts');
    expect(annotationType('user')).toBe('tf-hl-user');
  });

  it('never collides across distinct owners', () => {
    expect(annotationType('tts')).not.toBe(annotationType('search'));
    expect(annotationType('tts')).not.toBe(annotationType('user'));
  });

  it('is stable for the same owner', () => {
    expect(annotationType('tts')).toBe(annotationType('tts'));
  });
});

describe('annotationClassName', () => {
  it('namespaces by owner AND variant', () => {
    expect(annotationClassName('tts', 'spoken')).toBe('tf-hl-tts--spoken');
  });

  it('never collides across distinct owners, even with the same variant', () => {
    expect(annotationClassName('tts', 'spoken')).not.toBe(annotationClassName('user', 'spoken'));
  });

  it('never collides across distinct variants for the same owner', () => {
    expect(annotationClassName('tts', 'spoken-word')).not.toBe(
      annotationClassName('tts', 'spoken-sentence'),
    );
  });

  it('is stable for the same owner and variant', () => {
    expect(annotationClassName('tts', 'spoken')).toBe(annotationClassName('tts', 'spoken'));
  });
});
