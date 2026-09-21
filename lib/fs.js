'use strict'

const fs = require('bare-fs/promises')
const path = require('bare-path')
const storage = require('bare-storage')
const { swap } = require('fs-native-extensions')

async function stat(target) {
  try {
    return await fs.stat(target)
  } catch {
    return null
  }
}

async function sync(target, flags) {
  const handle = await fs.open(target, flags)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

module.exports = {
  root: () => storage.persistent(),
  join: (base, segment) => path.join(base, segment),
  async fileExists(target) {
    return (await stat(target))?.isFile() === true
  },
  async dirExists(target) {
    return (await stat(target))?.isDirectory() === true
  },
  makeDir: (target) => fs.mkdir(target, { recursive: true }),
  readText: (target) => fs.readFile(target, 'utf8'),
  async writeFile(target, data) {
    await fs.writeFile(target, data)
    await sync(target, 'r+')
  },
  removeDir: (target) => fs.rm(target, { recursive: true, force: true }),
  async commitDir(from, to) {
    await sync(from, 'r')

    if ((await stat(to))?.isDirectory()) {
      await swap(from, to)
      await fs.rm(from, { recursive: true, force: true })
    } else {
      await fs.rename(from, to)
    }

    await sync(path.dirname(to), 'r')
  }
}
