export type KeyCombo = {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  priority?: number;
  when?: (event: KeyboardEvent) => boolean;
  handler: (event: KeyboardEvent) => void;
};

const normalizeKey = (value: string) => value.trim().toLowerCase();

export const matchesKeyCombo = (event: KeyboardEvent, combo: KeyCombo) => {
  if (normalizeKey(event.key) !== normalizeKey(combo.key)) return false;
  if (combo.ctrl !== undefined && event.ctrlKey !== combo.ctrl) return false;
  if (combo.meta !== undefined && event.metaKey !== combo.meta) return false;
  if (combo.shift !== undefined && event.shiftKey !== combo.shift) return false;
  if (combo.alt !== undefined && event.altKey !== combo.alt) return false;
  if (combo.when && !combo.when(event)) return false;
  return true;
};

export const routeKeyCombos = (event: KeyboardEvent, combos: KeyCombo[]) => {
  const ranked = combos
    .map((combo, index) => ({ combo, index }))
    .sort((a, b) => {
      const ap = a.combo.priority ?? 0;
      const bp = b.combo.priority ?? 0;
      if (bp !== ap) return bp - ap;
      return a.index - b.index;
    });

  for (const { combo } of ranked) {
    if (!matchesKeyCombo(event, combo)) continue;
    combo.handler(event);
    return combo;
  }

  return null;
};
