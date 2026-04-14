(() => {
  const clean = (html) =>
    html
      .replace(/\snonce="[^"]*"/g, "")
      .replace(/\sintegrity="[^"]*"/g, "")
      .replace(/\scrossorigin="[^"]*"/g, "")
      .replace(/\sdata-headlessui-state="[^"]*"/g, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();

  const pick = (selector) => document.querySelector(selector);
  const nav = pick('nav[aria-label="Chat history"]');
  const main = pick("main");
  const composer =
    pick("form textarea")?.closest("form") ||
    pick("#prompt-textarea")?.closest("form") ||
    pick("textarea")?.closest("form") ||
    null;

  const cloneHeadNode = (node) => {
    const clone = node.cloneNode(true);
    if (!(clone instanceof Element)) return "";
    if (clone.tagName === "STYLE" || clone.tagName === "LINK") return clone.outerHTML;
    return "";
  };

  const headHtml = Array.from(document.head.children).map(cloneHeadNode).filter(Boolean).join("\n");

  const bodyParts = [
    `<div data-fixture-theme="${
      document.documentElement.classList.contains("dark") ? "dark" : "light"
    }"></div>`,
    `<meta name="fixture-origin" content="${location.origin}">`
  ];

  for (const [name, node] of [
    ["chat-history-nav", nav],
    ["main", main],
    ["composer", composer]
  ]) {
    if (!node) {
      bodyParts.push(`<!-- ${name}: null -->`);
      continue;
    }
    bodyParts.push(
      `<!-- ${name} -->\n<div data-fixture-root="${name}">${clean(node.outerHTML)}</div>`
    );
  }

  const output = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>chatgpt fixture</title>
  ${headHtml}
</head>
<body>
${bodyParts.join("\n\n")}
</body>
</html>`;

  const blob = new Blob([output], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `chatgpt-fixture-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
})();
