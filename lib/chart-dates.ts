export function chartDateKey(date?: Date | null) {
  if (!date || Number.isNaN(date.getTime())) return ''

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

export function sortedChartDateKeys(keys: Iterable<string>) {
  return [...keys].filter(Boolean).sort((first, second) => first.localeCompare(second))
}
