import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LinkifyText } from './linkify-text';

function render(text: string, isAgent = false) {
  return renderToStaticMarkup(createElement(LinkifyText, { text, isAgent }));
}

describe('LinkifyText', () => {
  it('renders plain text unchanged', () => {
    expect(render('Hello there\nHow are you?')).toBe(
      '<span>Hello there\nHow are you?</span>'
    );
  });

  it('links HTTP and HTTPS URLs', () => {
    const markup = render(
      'Visit http://legacy.example.com and https://example.com/path?q=1'
    );
    expect(markup).toContain(
      '<a href="http://legacy.example.com" target="_blank" rel="noopener noreferrer nofollow" class="text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">http://legacy.example.com</a>'
    );
    expect(markup).toContain(
      '<a href="https://example.com/path?q=1" target="_blank" rel="noopener noreferrer nofollow" class="text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">https://example.com/path?q=1</a>'
    );
  });

  it('adds HTTPS to www URLs while preserving their display text', () => {
    expect(render('Visit www.example.com')).toContain(
      '<a href="https://www.example.com" target="_blank" rel="noopener noreferrer nofollow" class="text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">www.example.com</a>'
    );
  });

  it('renders HTML-like message content as text', () => {
    const markup = render("<script>alert('xss')</script>");
    expect(markup).toContain('&lt;script&gt;');
    expect(markup).not.toContain('<script>');
  });

  it('links multiple URLs and leaves trailing punctuation outside the links', () => {
    const markup = render('https://one.example.com, then www.two.example.com!');
    expect(markup.match(/<a\b/g)).toHaveLength(2);
    expect(markup).toContain('>https://one.example.com</a>,');
    expect(markup).toContain('>www.two.example.com</a>!');
  });

  it('keeps balanced parentheses inside a URL', () => {
    expect(render('https://example.com/path_(test).')).toContain(
      '>https://example.com/path_(test)</a>.'
    );
  });

  it('does not link unsafe schemes', () => {
    const markup = render('javascript:alert(1) data:text/html,test');
    expect(markup).not.toContain('<a ');
    expect(markup).toContain('javascript:alert(1) data:text/html,test');
  });

  it('uses the outgoing link color for agent messages', () => {
    expect(render('https://example.com', true)).toContain(
      'class="text-primary-foreground underline underline-offset-2 hover:opacity-80"'
    );
  });
});
