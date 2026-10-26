export const HOME_STYLES = [
  { value: 'penthouse', label: 'Penthouse' },
] as const;
export type HomeStyle = typeof HOME_STYLES[number]['value'];
export function homeStyleLabel(value: unknown): string {
  return HOME_STYLES.find(style => style.value === value)?.label || '';
}
export function homeStyleValue(value: unknown): HomeStyle | '' {
  return HOME_STYLES.find(style => style.value === value)?.value || '';
}
