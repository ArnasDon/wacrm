import { describe, it, expect } from 'vitest';
import { decodeXmlEntities, extractTagText, readZipEntries } from './ooxml';
import { buildZip } from './test-support/build-zip';

describe('readZipEntries', () => {
  it('reads a stored (uncompressed) entry', () => {
    const zip = buildZip([{ name: 'hello.txt', data: 'hello world', method: 0 }]);
    const entries = readZipEntries(zip);
    expect(entries.get('hello.txt')?.toString('utf8')).toBe('hello world');
  });

  it('reads a deflate-compressed entry', () => {
    const zip = buildZip([{ name: 'hello.txt', data: 'hello world, compressed!', method: 8 }]);
    const entries = readZipEntries(zip);
    expect(entries.get('hello.txt')?.toString('utf8')).toBe('hello world, compressed!');
  });

  it('reads multiple entries', () => {
    const zip = buildZip([
      { name: 'a.xml', data: '<a/>', method: 0 },
      { name: 'b.xml', data: '<b/>', method: 8 },
    ]);
    const entries = readZipEntries(zip);
    expect(entries.size).toBe(2);
    expect(entries.get('a.xml')?.toString('utf8')).toBe('<a/>');
    expect(entries.get('b.xml')?.toString('utf8')).toBe('<b/>');
  });

  it('throws a readable error for a non-ZIP buffer', () => {
    expect(() => readZipEntries(Buffer.from('not a zip'))).toThrow(/ZIP/);
  });
});

describe('extractTagText', () => {
  it('extracts inner text of every matching tag', () => {
    const xml = '<w:p><w:t>Hola</w:t><w:t> mundo</w:t></w:p>';
    expect(extractTagText(xml, 'w:t')).toEqual(['Hola', ' mundo']);
  });

  it('decodes XML entities', () => {
    expect(extractTagText('<t>A &amp; B &lt;3&gt;</t>', 't')).toEqual(['A & B <3>']);
  });

  it('returns an empty array when the tag is absent', () => {
    expect(extractTagText('<p>no tags here</p>', 'w:t')).toEqual([]);
  });
});

describe('decodeXmlEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeXmlEntities('&lt;tag&gt; &amp; &#65;')).toBe('<tag> & A');
  });
});
