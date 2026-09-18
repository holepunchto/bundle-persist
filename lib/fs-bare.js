'use strict'

const fs = require('fs/promises')
const path = require('path')
const storage = require('bare-storage')
const { swap } = require('fs-native-extensions')

const base = require('./fs.js')

async function sync(target, flags) {
  const handle = await fs.open(target, flags)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

module.exports = {
  ...base,
  root: () => storage.persistent(),
  async writeFile(target, data) {
    await fs.writeFile(target, data)
    await sync(target, 'r+')
  },
  async commitDir(from, to) {
    await sync(from, 'r') // make sure the content is written to disk before swap

    if (await base.dirExists(to)) {
      await swap(from, to)
      await fs.rm(from, { recursive: true, force: true })
    } else {
      await fs.rename(from, to)
    }

    await sync(path.dirname(to), 'r')
  }
}
