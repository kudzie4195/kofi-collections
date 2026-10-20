import { describe, expect, it } from 'vitest';
import { creditLine } from './format';

describe('creditLine', () => {
  it('keeps sentence-style credits as written', () => {
    expect(creditLine('Photograph from koficollections.org')).toBe('Photograph from koficollections.org');
    expect(creditLine('Painting by Clarence James · photograph from koficollections.org')).toBe('Painting by Clarence James · photograph from koficollections.org');
    expect(creditLine('© Kofi Collections')).toBe('© Kofi Collections');
  });
  it('prefixes a bare name with ©', () => {
    expect(creditLine('Mara Oyelaran')).toBe('© Mara Oyelaran');
    expect(creditLine('  June Takahashi-Bell ')).toBe('© June Takahashi-Bell');
  });
});
