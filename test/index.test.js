'use strict'

const test = require('brittle')
const b4a = require('b4a')
const fs = require('fs/promises')
const path = require('path')

const BundlePersist = require('..')

const BUNDLE = b4a.from([1, 2, 3])

async function tmp(t) {
  const root = await fs.mkdtemp(path.join(__dirname, 'tmp-'))
  t.teardown(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

async function read(root, ...segments) {
  return fs.readFile(path.join(root, 'ota', ...segments))
}

test('save writes the bundle, the manifest and the assets', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root })

  await bundles.save(BUNDLE, '4.24.0', { assets: { 'assets/src/logo.png': b4a.from([9]) } })

  t.ok(b4a.equals(await read(root, 'app.bundle'), BUNDLE))
  t.alike(JSON.parse(b4a.toString(await read(root, 'manifest.json'))), { version: '4.24.0' })
  t.ok(b4a.equals(await read(root, 'assets/src/logo.png'), b4a.from([9])))
  t.is(await bundles.savedVersion(), '4.24.0')
})

test('save accepts a prerelease version', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root })

  await bundles.save(BUNDLE, '4.24.0-nightly.3')

  t.is(await bundles.savedVersion(), '4.24.0-nightly.3')
})

test('save replaces the previous update', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root })

  await bundles.save(BUNDLE, '4.24.0', { assets: { 'assets/old.png': b4a.from([1]) } })
  await bundles.save(b4a.from([4]), '4.25.0')

  t.is(await bundles.savedVersion(), '4.25.0')
  t.ok(b4a.equals(await read(root, 'app.bundle'), b4a.from([4])))
  t.absent(await exists(path.join(root, 'ota', 'assets')))
})

test('save rejects a version that is not semver and keeps what is stored', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root })

  await bundles.save(BUNDLE, '4.24.0')

  for (const version of ['latest', '4.24', '4.24.0.1', '', null]) {
    await t.exception(bundles.save(b4a.from([7]), version), /Invalid bundle version/)
  }

  t.is(await bundles.savedVersion(), '4.24.0')
  t.ok(b4a.equals(await read(root, 'app.bundle'), BUNDLE))
})

test('overlapping saves write only the newest bundle', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root })

  await Promise.all([
    bundles.save(b4a.from([1]), '4.24.0'),
    bundles.save(b4a.from([2]), '4.25.0'),
    bundles.save(b4a.from([3]), '4.26.0')
  ])

  t.is(await bundles.savedVersion(), '4.26.0')
  t.ok(b4a.equals(await read(root, 'app.bundle'), b4a.from([3])))
  t.absent(await exists(path.join(root, 'ota.tmp')), 'staging directory is gone')
})

test('savedVersion is null when nothing is stored', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root })

  t.is(await bundles.savedVersion(), null)
})

test('savedVersion is null when the manifest is missing', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root })

  await bundles.save(BUNDLE, '4.24.0')
  await fs.rm(path.join(root, 'ota', 'manifest.json'))

  t.is(await bundles.savedVersion(), null)
})

test('savedVersion is null when the manifest is unusable', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root })

  await bundles.save(BUNDLE, '4.24.0')

  for (const manifest of ['{not json', '{}', JSON.stringify({ version: 'latest' })]) {
    await fs.writeFile(path.join(root, 'ota', 'manifest.json'), manifest)
    t.is(await bundles.savedVersion(), null, manifest)
  }
})

test('savedVersion is null when the bundle is missing', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root })

  await bundles.save(BUNDLE, '4.24.0')
  await fs.rm(path.join(root, 'ota', 'app.bundle'))

  t.is(await bundles.savedVersion(), null)
})

test('an interrupted save leaves the previous update in place', async (t) => {
  await interruptedSave(t, require('../lib/fs.js'))
})

test('an interrupted atomic save leaves the previous update in place', async (t) => {
  const bare = tryRequire('../lib/fs-bare.js')
  if (bare === null) return t.pass('no atomic swap in this runtime')

  await interruptedSave(t, bare)
})

async function interruptedSave(t, io) {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root, fs: io })

  await bundles.save(BUNDLE, '4.24.0')

  const failing = {
    ...io,
    commitDir() {
      throw new Error('interrupted')
    }
  }

  const interrupted = new BundlePersist({ root, fs: failing })
  await t.exception(interrupted.save(b4a.from([4]), '4.25.0'), /interrupted/)

  t.is(await bundles.savedVersion(), '4.24.0', 'the stored update survived')
  t.ok(b4a.equals(await read(root, 'app.bundle'), BUNDLE))
}

function tryRequire(id) {
  try {
    return require(id)
  } catch {
    return null
  }
}

test('constructing without a root throws', async (t) => {
  t.exception(() => new BundlePersist(), /No storage root/)
})

async function exists(target) {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
}
