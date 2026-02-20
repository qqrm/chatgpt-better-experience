import { FeatureContext, FeatureHandle } from "../application/featureContext";

const STYLE_ID = "qqrm-hide-share-button-style";

const STYLE_TEXT = `
button[aria-label="Share"],
button[title="Share"],
button[aria-label="Поделиться"],
button[title="Поделиться"],
button[aria-label="Compartir"],
button[title="Compartir"],
button[aria-label="Partager"],
button[title="Partager"],
button[aria-label="Teilen"],
button[title="Teilen"],
[role="button"][aria-label="Share"],
[role="button"][title="Share"],
[role="button"][aria-label="Поделиться"],
[role="button"][title="Поделиться"],
[role="button"][aria-label="Compartir"],
[role="button"][title="Compartir"],
[role="button"][aria-label="Partager"],
[role="button"][title="Partager"],
[role="button"][aria-label="Teilen"],
[role="button"][title="Teilen"] {
  display: none !important;
}
`;

export function initHideShareButtonFeature(ctx: FeatureContext): FeatureHandle {
  const ensureStyle = () => {
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = STYLE_TEXT;
      const host = document.head ?? document.documentElement;
      if (!host) return;
      host.appendChild(style);
    }
  };

  const removeStyle = () => {
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
  };

  const update = () => {
    if (ctx.settings.hideShareButton) ensureStyle();
    else removeStyle();
  };

  update();

  return {
    name: "hideShareButton",
    dispose: () => removeStyle(),
    onSettingsChange: (next, prev) => {
      if (next.hideShareButton !== prev.hideShareButton) {
        update();
      }
    },
    getStatus: () => ({ active: ctx.settings.hideShareButton })
  };
}
