(() => {
  const PLACEHOLDER = "[fixture-text]";
  const allowedAttrs = new Set([
    "class",
    "contenteditable",
    "data-message-author-role",
    "data-scroll-root",
    "data-testid",
    "name",
    "role",
    "type"
  ]);

  const sanitize = (source) => {
    const root = source.cloneNode(true);
    if (!(root instanceof Element)) return null;

    for (const ignored of root.querySelectorAll("script, style, link, iframe, object, embed")) {
      ignored.remove();
    }

    for (const element of [root, ...root.querySelectorAll("*")]) {
      for (const attribute of Array.from(element.attributes)) {
        if (allowedAttrs.has(attribute.name)) continue;
        if (attribute.name === "aria-expanded") continue;
        element.removeAttribute(attribute.name);
      }
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const textNode of textNodes) {
      if (textNode.textContent?.trim()) textNode.textContent = PLACEHOLDER;
    }

    return root;
  };

  const pick = (selector) => document.querySelector(selector);
  const composer =
    pick("form[data-testid='composer']") ||
    pick("#prompt-textarea")?.closest("form") ||
    pick("textarea")?.closest("form");
  const roots = [
    ["chat-history-nav", pick("nav[aria-label='Chat history']")],
    ["main", pick("main")],
    ["composer", composer]
  ];

  const body = roots
    .map(([name, node]) => {
      const safe = node ? sanitize(node) : null;
      return safe
        ? `<!-- ${name} -->\n<div data-fixture-root="${name}">${safe.outerHTML}</div>`
        : `<!-- ${name}: null -->`;
    })
    .join("\n\n");

  const output = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="fixture-kind" content="sanitized-structure" />
  <title>chatgpt structural fixture</title>
</head>
<body>
${body}
</body>
</html>`;

  const blob = new Blob([output], { type: "text/html" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `chatgpt-structure-${new Date().toISOString().slice(0, 10)}.html`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
})();
