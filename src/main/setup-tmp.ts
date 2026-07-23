import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

// Set up a custom temp directory inside the app's user data to avoid ENOSPC
// on systems with small /tmp (tmpfs) partitions, like the thin clients.
try {
  const customTmp = join(app.getPath('userData'), 'tmp')
  mkdirSync(customTmp, { recursive: true })
  process.env.TMPDIR = customTmp
  app.setPath('temp', customTmp)
} catch (err) {
  console.error('Failed to set up custom temp directory:', err)
}
