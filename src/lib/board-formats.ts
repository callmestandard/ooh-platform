/**
 * The board format taxonomy — the values stored in `boards.format` and the
 * labels shown for them. New code (budget estimator, formats guide) reads
 * from here so content pages and board data can't drift apart.
 */

export const BOARD_FORMATS = [
  { value: 'billboard',    label: 'Billboard' },
  { value: 'unipole',      label: 'Unipole' },
  { value: 'gantry',       label: 'Gantry' },
  { value: 'bridge_panel', label: 'Bridge Panel' },
  { value: 'wall_drape',   label: 'Wall Drape' },
  { value: 'digital',      label: 'Digital / LED' },
  { value: 'led',          label: 'LED Screen' },
] as const;

export type BoardFormat = typeof BOARD_FORMATS[number]['value'];

export const BOARD_FORMAT_LABELS: Record<string, string> = Object.fromEntries(
  BOARD_FORMATS.map(f => [f.value, f.label]),
);

export function boardFormatLabel(format: string | null | undefined): string {
  if (!format) return '—';
  return BOARD_FORMAT_LABELS[format] ?? format;
}

/**
 * `digital` and `led` are two stored spellings of the same thing (the board
 * forms save 'digital', the bulk importer saves 'led'), so anything that
 * filters or aggregates by format treats them as one group.
 */
export const FORMAT_GROUPS: { key: string; label: string; formats: BoardFormat[] }[] = [
  { key: 'billboard',    label: 'Billboard (static)', formats: ['billboard'] },
  { key: 'unipole',      label: 'Unipole',            formats: ['unipole'] },
  { key: 'gantry',       label: 'Gantry',             formats: ['gantry'] },
  { key: 'bridge_panel', label: 'Bridge Panel',       formats: ['bridge_panel'] },
  { key: 'wall_drape',   label: 'Wall Drape',         formats: ['wall_drape'] },
  { key: 'digital',      label: 'Digital / LED',      formats: ['digital', 'led'] },
];

export function formatGroup(key: string) {
  return FORMAT_GROUPS.find(g => g.key === key) ?? null;
}
