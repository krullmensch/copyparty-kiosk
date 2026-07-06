import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'

/**
 * One file queued for upload, with the vpath-relative subdirectory it should
 * land in on the server. `subVpath` is '' for a loose file (drops straight into
 * the target), or 'Album/disc1' for a file inside a dropped folder/zip. `topUnit`
 * is the top-level folder/zip name the file belongs to (null for loose files),
 * used for collision resolution against the target listing.
 */
export interface ExpandItem {
  filePath: string
  subVpath: string
  topUnit: string | null
}

export interface ExpandResult {
  items: ExpandItem[]
  /** temp dirs created for zip extraction; caller must remove after upload. */
  tempDirs: string[]
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/')
}

/** recursively list regular files under `root`, returning absolute paths. */
async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop() as string
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const abs = join(dir, e.name)
      if (e.isDirectory()) stack.push(abs)
      else if (e.isFile()) out.push(abs)
      // symlinks/sockets/etc. are skipped: they don't survive a copy meaningfully
    }
  }
  return out
}

/**
 * extracts `zipPath` into a fresh temp dir. guards against zip-slip (entries
 * with `..` or absolute paths that would escape the extract root are skipped).
 * returns the extract root.
 */
function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip open failed'))
      zip.on('error', reject)
      zip.on('end', resolve)
      zip.readEntry()
      zip.on('entry', (entry) => {
        const name = entry.fileName
        // normalize + reject escapes
        const safe = join(destDir, name)
        if (safe !== destDir && !safe.startsWith(destDir + sep)) {
          zip.readEntry() // zip-slip attempt: skip
          return
        }
        if (name.endsWith('/')) {
          // directory entry
          mkdir(safe, { recursive: true })
            .then(() => zip.readEntry())
            .catch(reject)
          return
        }
        zip.openReadStream(entry, (rErr, rs) => {
          if (rErr || !rs) return reject(rErr ?? new Error('zip read failed'))
          mkdir(dirname(safe), { recursive: true })
            .then(() => pipeline(rs, createWriteStream(safe)))
            .then(() => zip.readEntry())
            .catch(reject)
        })
      })
    })
  })
}

/**
 * if a directory contains exactly one child and that child is a directory,
 * return the child (avoids `game.zip` → `game/game/...` double-nesting when the
 * archive already wraps its contents in one top folder). otherwise return dir.
 */
async function collapseSingleRoot(dir: string): Promise<{ root: string; name: string }> {
  const entries = await readdir(dir, { withFileTypes: true })
  if (entries.length === 1 && entries[0].isDirectory()) {
    return { root: join(dir, entries[0].name), name: entries[0].name }
  }
  return { root: dir, name: basename(dir) }
}

/**
 * expands dropped local paths into a flat upload list that preserves each
 * folder/zip as one intact unit at the target root (the source browse path is
 * NOT reproduced). directories are walked; zips are extracted to temp.
 */
export async function expandForUpload(localPaths: string[]): Promise<ExpandResult> {
  const items: ExpandItem[] = []
  const tempDirs: string[] = []

  try {
    for (const p of localPaths) {
      const st = await stat(p)

      if (st.isDirectory()) {
        const unit = basename(p)
        const parent = dirname(p)
        for (const f of await walkFiles(p)) {
          const rel = toPosix(relative(parent, dirname(f))) // e.g. "Album/disc1"
          items.push({ filePath: f, subVpath: rel, topUnit: unit })
        }
        continue
      }

      if (extname(p).toLowerCase() === '.zip') {
        const tmp = await mkdtemp(join(tmpdir(), 'cpk-zip-'))
        tempDirs.push(tmp)
        try {
          await extractZip(p, tmp)
        } catch (err) {
          throw new Error(`ZIP "${basename(p)}": ${(err as Error).message}`)
        }
        const { root, name } = await collapseSingleRoot(tmp)
        const unit = name === basename(tmp) ? basename(p, extname(p)) : name
        for (const f of await walkFiles(root)) {
          const inner = toPosix(relative(root, dirname(f))) // '' or "data/sub"
          const rel = inner ? `${unit}/${inner}` : unit
          items.push({ filePath: f, subVpath: rel, topUnit: unit })
        }
        continue
      }

      // loose file: lands straight into the target, server handles name collisions
      items.push({ filePath: p, subVpath: '', topUnit: null })
    }
  } catch (err) {
    // don't leak temp dirs if expansion fails partway through
    await cleanupTempDirs(tempDirs)
    throw err
  }

  return { items, tempDirs }
}

/** best-effort recursive cleanup of the temp dirs from expandForUpload. */
export async function cleanupTempDirs(dirs: string[]): Promise<void> {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})))
}

/**
 * given the set of names already present in the target vpath, produce a rename
 * map for the distinct top-level units so each dropped folder/zip lands in its
 * own directory (never merged into an existing one). loose files (topUnit null)
 * are left to the server's own collision handling.
 */
export function resolveCollisions(
  items: ExpandItem[],
  existingNames: Set<string>
): Map<string, string> {
  const used = new Set(existingNames)
  const map = new Map<string, string>()
  for (const it of items) {
    if (it.topUnit == null || map.has(it.topUnit)) continue
    let candidate = it.topUnit
    let n = 2
    while (used.has(candidate)) candidate = `${it.topUnit} (${n++})`
    used.add(candidate)
    map.set(it.topUnit, candidate)
  }
  return map
}
