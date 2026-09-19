function normalized(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function locationLabel(...parts: unknown[]) {
  const visible: string[] = [];
  const covered = new Set<string>();

  for (const part of parts) {
    const value = String(part || "").trim();
    if (!value) continue;
    for (const segment of value.split(",")) {
      const display = segment.trim();
      const segmentKey = normalized(segment);
      if (!display || !segmentKey || covered.has(segmentKey)) continue;
      visible.push(display);
      covered.add(segmentKey);
    }
  }

  return visible.join(", ");
}
