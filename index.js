'use strict'

const { Version } = require('bare-semver')
const debounceify = require('debounceify')
const fs = require('#fs')

module.exports = class BundlePersist {
  constructor(opts = {}) {
    this.fs = opts.fs || fs
    this.root = opts.root || this.fs.root()
    this.otaDir = opts.otaDir || 'ota'
    this.stagingDir = opts.stagingDir || 'ota.tmp'
    this.bundleFile = opts.bundleFile || 'app.bundle'
    this.manifestFile = opts.manifestFile || 'manifest.json'
    this.dir = this.fs.join(this.root, this.otaDir)
    this._pending = null
    this._write = debounceify(this._write.bind(this))
  }

  save(bundle, version, opts = {}) {
    const assets = opts.assets || {}

    if (!isValidVersion(version)) {
      return Promise.reject(new Error(`Invalid bundle version: ${version}`))
    }

    this._pending = { bundle, version, assets }
    return this._write()
  }

  async savedVersion() {
    const fs = this.fs

    if (!(await fs.fileExists(fs.join(this.dir, this.bundleFile)))) return null

    const manifest = fs.join(this.dir, this.manifestFile)
    if (!(await fs.fileExists(manifest))) return null

    try {
      const { version } = JSON.parse(await fs.readText(manifest))
      return isValidVersion(version) ? version : null
    } catch {
      return null
    }
  }

  async _write() {
    const pending = this._pending
    if (pending === null) return

    this._pending = null

    const { bundle, version, assets } = pending
    const fs = this.fs
    const staging = fs.join(this.root, this.stagingDir)

    if (await fs.dirExists(staging)) await fs.removeDir(staging)
    await fs.makeDir(staging)
    await fs.writeFile(fs.join(staging, this.bundleFile), bundle)

    for (const [path, bytes] of Object.entries(assets)) {
      const segments = path.split('/')
      const name = segments.pop()
      let dir = staging
      for (const segment of segments) {
        dir = fs.join(dir, segment)
        await fs.makeDir(dir)
      }
      await fs.writeFile(fs.join(dir, name), bytes)
    }

    await fs.writeFile(fs.join(staging, this.manifestFile), JSON.stringify({ version }))
    await fs.commitDir(staging, this.dir)
  }
}

function isValidVersion(version) {
  if (typeof version !== 'string') return false

  try {
    Version.parse(version)
    return true
  } catch {
    return false
  }
}
