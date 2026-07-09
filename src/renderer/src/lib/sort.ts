export type SortField = 'name' | 'size' | 'mtime' | 'ext'
export type SortDir = 'asc' | 'desc'

export interface SortableEntry {
  name: string
  size: number
  mtime: number
  isDirectory: boolean
}

function nameCompare(a: SortableEntry, b: SortableEntry): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

function fieldCompare(field: SortField, a: SortableEntry, b: SortableEntry): number {
  switch (field) {
    case 'name':
      return nameCompare(a, b)
    case 'size':
      // Ordner haben keine sinnvolle Größe -> nach Name sortieren
      if (a.isDirectory && b.isDirectory) return nameCompare(a, b)
      return a.size - b.size
    case 'mtime':
      return a.mtime - b.mtime
    case 'ext': {
      if (a.isDirectory && b.isDirectory) return nameCompare(a, b)
      const e = extOf(a.name).localeCompare(extOf(b.name))
      return e !== 0 ? e : nameCompare(a, b)
    }
  }
}

/**
 * Ordner stehen immer vor Dateien, unabhängig von Sortierfeld/-richtung.
 * `desc` invertiert nur den Feldvergleich, nicht die dirs-first-Regel.
 */
export function compareBy(
  field: SortField,
  dir: SortDir
): (a: SortableEntry, b: SortableEntry) => number {
  return (a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    const cmp = fieldCompare(field, a, b)
    return dir === 'desc' ? -cmp : cmp
  }
}
