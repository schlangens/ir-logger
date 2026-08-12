// Blocks contain paragraphs, headings, lists, and fenced code.
// Inline runs contain text, formatting, links, or single-newline breaks.
const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const safeHref = (value) => {
  const normalized = String(value).replace(/^[\u0000-\u0020]+/, '').toLowerCase();
  return /^(https?:|mailto:)/.test(normalized) ? value : null;
};

function inlineRuns(source) {
  const escaped = escapeHtml(source);
  const runs = [];
  let position = 0;
  const pattern = /(\[([^\]]*)\]\(([^)]*)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\n)/g;

  for (const match of escaped.matchAll(pattern)) {
    if (match.index > position) {
      runs.push({ type: 'text', text: escaped.slice(position, match.index) });
    }
    if (match[0] === '\n') {
      runs.push({ type: 'break' });
    } else if (match[2] !== undefined) {
      const href = safeHref(match[3]);
      if (href) {
        runs.push({ type: 'link', text: match[2], href });
      } else {
        runs.push({ type: 'text', text: match[0] });
      }
    } else if (match[4] !== undefined) {
      runs.push({ type: 'bold', text: match[4] });
    } else if (match[5] !== undefined) {
      runs.push({ type: 'italic', text: match[5] });
    } else {
      runs.push({ type: 'code', text: match[6] });
    }
    position = match.index + match[0].length;
  }
  if (position < escaped.length) {
    runs.push({ type: 'text', text: escaped.slice(position) });
  }
  return runs;
}

function renderMarkdown(input) {
  const lines = String(input ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let code = null;
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', inlines: inlineRuns(paragraph.join('\n')) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  const flushCode = () => {
    if (code) {
      blocks.push({
        type: 'code',
        text: code.map((line) => escapeHtml(line)).join('\n'),
      });
    }
    code = null;
  };

  for (const line of lines) {
    if (code) {
      if (/^\s*```/.test(line)) flushCode();
      else code.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) {
      flushParagraph();
      flushList();
      code = [];
      continue;
    }
    const heading = /^(##|###) (.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        inlines: inlineRuns(heading[2]),
      });
      continue;
    }
    const bullet = /^[-*] (.*)$/.exec(line);
    const numbered = /^\d+\. (.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { type: 'list', ordered, items: [] };
      }
      list.items.push(inlineRuns((bullet || numbered)[1]));
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushCode();
  flushParagraph();
  flushList();
  return blocks;
}

const unescapeHtml = (value) =>
  String(value)
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

module.exports = { renderMarkdown, escapeHtml, unescapeHtml };
