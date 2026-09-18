'use strict'

const { Directory, File, Paths } = require('expo-file-system')

// Paths here are file:// URIs, which is what expo-file-system takes and returns. Only move is
// asynchronous natively; the rest resolve immediately.
module.exports = {
  root: () => Paths.document.uri.replace(/\/$/, ''),
  join: (base, segment) => `${base}/${segment}`,
  async fileExists(target) {
    return new File(target).exists
  },
  async dirExists(target) {
    return new Directory(target).exists
  },
  async makeDir(target) {
    new Directory(target).create({ intermediates: true, idempotent: true })
  },
  async readText(target) {
    return new File(target).text()
  },
  async writeFile(target, data) {
    const file = new File(target)
    if (!file.exists) file.create({ intermediates: true })
    file.write(data)
  },
  async removeFile(target) {
    const file = new File(target)
    if (file.exists) file.delete()
  },
  async removeDir(target) {
    const dir = new Directory(target)
    if (dir.exists) dir.delete()
  },
  // expo-file-system has no atomic swap, so this is a delete followed by a rename.
  async commitDir(from, to) {
    const current = new Directory(to)
    if (current.exists) current.delete()

    new Directory(from).rename(to.slice(to.lastIndexOf('/') + 1))
  }
}
