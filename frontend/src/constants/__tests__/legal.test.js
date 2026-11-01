// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LEGAL_DOCS, LEGAL_EDITION, LEGAL_VERSION, legalDoc } from '../legal.js';

/**
 * Редакция документов живёт в двух местах: во фронтенде (дата на странице
 * документа) и на сервере (что записывается пользователю при согласии).
 * Разъедутся — и пользователь примет одну редакцию, а в базу запишется
 * другая, либо окно «примите документы» не появится после правки.
 */
describe('редакция юридических документов', () => {
  it('совпадает с backend/app/core/legal.py', () => {
    const source = readFileSync(
      new URL('../../../../backend/app/core/legal.py', import.meta.url),
      'utf8'
    );
    const match = source.match(/^LEGAL_VERSION\s*=\s*"([^"]+)"/m);
    expect(match, 'в legal.py нет строки LEGAL_VERSION = "…"').not.toBeNull();
    expect(LEGAL_VERSION).toBe(match[1]);
  });

  it('дата редакции словами считается из версии', () => {
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [y, , d] = LEGAL_VERSION.split('-').map(Number);
    expect(LEGAL_EDITION).toMatch(new RegExp(`^${d} [а-я]+ ${y} г\\.$`));
  });

  it('у каждого документа есть адрес и заголовок', () => {
    expect(LEGAL_DOCS.map((d) => d.slug)).toEqual(['terms', 'privacy', 'consent']);
    for (const d of LEGAL_DOCS) {
      expect(legalDoc(d.slug)).toBe(d);
      expect(d.title.length).toBeGreaterThan(10);
    }
    expect(legalDoc('nope')).toBeNull();
  });
});
