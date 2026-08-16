function escapeHtml(value) {
  const text = String(value ?? '');
  let out = '';
  for (const ch of text) {
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if (ch === "'") out += '&#39;';
    else if (ch === '(') out += '&#40;';
    else if (ch === ')') out += '&#41;';
    else out += ch;
  }
  return out;
}

function attrEscape(value) {
  const text = String(value ?? '');
  let out = '';
  for (const ch of text) {
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if (ch === "'") out += '&#39;';
    else out += ch;
  }
  return out;
}

function safeHref(value) {
  const normalized = String(value).replace(/^[\u0000-\u0020]+/, '').toLowerCase();
  return /^(https?:|mailto:)/.test(normalized) ? value : null;
}

function renderInline(source) {
  const pattern = /(\[([^\]]*)\]\(([^)]*)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\n)/g;
  let position = 0;
  let html = '';

  for (const match of source.matchAll(pattern)) {
    if (match.index > position) {
      html += escapeHtml(source.slice(position, match.index));
    }

    if (match[0] === '\n') {
      html += '<br>';
    } else if (match[2] !== undefined) {
      const href = safeHref(match[3]);
      if (href) {
        html += `<a href="${attrEscape(href)}" rel="noopener noreferrer" target="_blank">${escapeHtml(match[2])}</a>`;
      } else {
        html += escapeHtml(match[0]);
      }
    } else if (match[4] !== undefined) {
      html += `<strong>${escapeHtml(match[4])}</strong>`;
    } else if (match[5] !== undefined) {
      html += `<em>${escapeHtml(match[5])}</em>`;
    } else if (match[6] !== undefined) {
      html += `<code>${escapeHtml(match[6])}</code>`;
    }

    position = match.index + match[0].length;
  }

  if (position < source.length) {
    html += escapeHtml(source.slice(position));
  }

  return html;
}

export function renderToHtml(input) {
  const lines = String(input ?? '').replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let paragraph = [];
  let code = null;
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      html += `<p>${renderInline(paragraph.join('\n'))}</p>\n`;
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list) {
      const tag = list.ordered ? 'ol' : 'ul';
      html += `<${tag}>\n${list.items.map((item) => `<li>${item}</li>`).join('\n')}\n</${tag}>\n`;
      list = null;
    }
  };

  const flushCode = () => {
    if (code) {
      const body = code.map((line) => escapeHtml(line)).join('\n');
      html += `<pre><code>${body}</code></pre>\n`;
      code = null;
    }
  };

  for (const line of lines) {
    if (code) {
      if (/^\s*```/.test(line)) {
        flushCode();
      } else {
        code.push(line);
      }
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
      const level = heading[1].length;
      const tag = level === 2 ? 'h3' : 'h4';
      html += `<${tag}>${renderInline(heading[2])}</${tag}>\n`;
      continue;
    }

    const bullet = /^[-*] (.*)$/.exec(line);
    const numbered = /^\d+\. (.*)$/.exec(line);

    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(renderInline((bullet || numbered)[1]));
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

  return html.trim();
}

export function renderMarkdown(input) {
  return renderToHtml(input);
}
