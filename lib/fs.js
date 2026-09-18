'use strict'

const fs = require('fs/promises')
const path = require('path')

async function stat(target) {
  try {
    return await fs.stat(target)
  } catch {
    return null
  }
}

module.exports = {
  root() {
    throw new Error('No storage root: pass { root } to the bundle-persist call')
  },
  join: (base, segment) => path.join(base, segment),
  async fileExists(target) {
    return (await stat(target))?.isFile() === true
  },
  async dirExists(target) {
    return (await stat(target))?.isDirectory() === true
  },
  makeDir: (target) => fs.mkdir(target, { recursive: true }),
  readText: (target) => fs.readFile(target, 'utf8'),
  writeFile: (target, data) => fs.writeFile(target, data),
  removeFile: (target) => fs.rm(target, { force: true }),
  removeDir: (target) => fs.rm(target, { recursive: true, force: true }),
  // Two operations, so a crash in between loses the stored update. The rename itself is atomic,
  // so what is left behind is the whole old update or the whole new one, never a mixture.
  async commitDir(from, to) {
    await fs.rm(to, { recursive: true, force: true })
    await fs.rename(from, to)
  }
}
