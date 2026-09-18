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

test('save stages the bundle, manifest and assets until apply', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root })

  t.is(
    await bundles.save(BUNDLE, '4.24.0', { assets: { 'assets/src/logo.png': b4a.from([9]) } }),
    true
  )

  t.is(await bundles.savedVersion(), null)
  t.absent(await exists(path.join(root, 'ota')))
  t.ok(b4a.equals(await fs.readFile(path.join(root, 'ota.tmp', 'app.bundle')), BUNDLE))
  t.alike(JSON.parse(await fs.readFile(path.join(root, 'ota.tmp', 'manifest.json'), 'utf8')), {
    version: '4.24.0'
  })
  t.is(await bundles.apply(), true)

  t.ok(b4a.equals(await read(root, 'app.bundle'), BUNDLE))
  t.alike(JSON.parse(b4a.toString(await read(root, 'manifest.json'))), { version: '4.24.0' })
  t.ok(b4a.equals(await read(root, 'assets/src/logo.png'), b4a.from([9])))
  t.is(await bundles.savedVersion(), '4.24.0')
})

test('save accepts a prerelease version', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root })

  await bundles.save(BUNDLE, '4.24.0-nightly.3')
  await bundles.apply()

  t.is(await bundles.savedVersion(), '4.24.0-nightly.3')
})

test('save checks minver using semver precedence and persists it when compatible', async (t) => {
  for (const [currentVersion, minver, compatible] of [
    ['4.24.0', '4.23.0', true],
    ['4.24.0', '4.24.0', true],
    ['4.24.0', '4.25.0', false],
    ['4.24.0-nightly.2', '4.24.0-nightly.3', false],
    ['4.24.0-nightly.3', '4.24.0-nightly.2', true],
    ['4.24.0-nightly.3', '4.24.0', false],
    ['4.24.0+native', '4.24.0+other', true]
  ]) {
    const root = await tmp(t)
    const bundles = new BundlePersist({ root, currentVersion })

    t.is(bundles.isCompatible(minver), compatible)
    t.alike(await fs.readdir(root), [], 'compatibility check writes no files')
    t.is(await bundles.save(BUNDLE, '4.26.0', { minver }), compatible)
    if (compatible) {
      t.alike(JSON.parse(await fs.readFile(path.join(root, 'ota.tmp', 'manifest.json'), 'utf8')), {
        version: '4.26.0',
        minver
      })
    } else {
      t.alike(await fs.readdir(root), [], 'incompatible update writes no files')
    }
    t.is(await bundles.apply(), compatible)
  }
})

test('currentVersion and minver must be valid semver when supplied', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root, currentVersion: '4.24.0' })

  t.is(bundles.isCompatible(), true)
  t.is(new BundlePersist({ root }).isCompatible(), true)

  for (const version of ['latest', '4.24', '', null, 4]) {
    t.exception(
      () => new BundlePersist({ root, currentVersion: version }),
      /Invalid current version/
    )
    t.exception(() => bundles.isCompatible(version), /Invalid minimum version/)
    await t.exception(
      bundles.save(BUNDLE, '4.25.0', { minver: version }),
      /Invalid minimum version/
    )
  }

  t.exception(
    () => new BundlePersist({ root }).isCompatible('4.24.0'),
    /currentVersion is required/
  )
  await t.exception(
    new BundlePersist({ root }).save(BUNDLE, '4.25.0', { minver: '4.24.0' }),
    /currentVersion is required/
  )
  t.alike(await fs.readdir(root), [])
})

test('an incompatible update preserves the active and staged bundles', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root, currentVersion: '4.24.0' })

  await bundles.save(BUNDLE, '4.24.0', { assets: { 'assets/old.png': b4a.from([1]) } })
  await bundles.apply()
  await bundles.save(b4a.from([4]), '4.25.0', {
    minver: '4.24.0',
    assets: { 'assets/new.png': b4a.from([2]) }
  })

  t.is(await bundles.save(b4a.from([5]), '4.26.0', { minver: '4.25.0' }), false)
  t.is(await bundles.savedVersion(), '4.24.0')
  t.ok(b4a.equals(await read(root, 'app.bundle'), BUNDLE))
  t.ok(b4a.equals(await read(root, 'assets/old.png'), b4a.from([1])))
  t.ok(b4a.equals(await fs.readFile(path.join(root, 'ota.tmp', 'app.bundle')), b4a.from([4])))

  t.is(await bundles.apply(), true)
  t.is(await bundles.savedVersion(), '4.25.0')
  t.ok(b4a.equals(await read(root, 'assets/new.png'), b4a.from([2])))
  t.alike(JSON.parse(b4a.toString(await read(root, 'manifest.json'))), {
    version: '4.25.0',
    minver: '4.24.0'
  })
})

test('save preserves the running bundle and assets until apply', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root })

  await bundles.save(BUNDLE, '4.24.0', { assets: { 'assets/old.png': b4a.from([1]) } })
  await bundles.apply()
  await bundles.save(b4a.from([4]), '4.25.0')

  t.is(await bundles.savedVersion(), '4.24.0')
  t.ok(b4a.equals(await read(root, 'app.bundle'), BUNDLE))
  t.ok(b4a.equals(await read(root, 'assets/old.png'), b4a.from([1])))

  await bundles.apply()

  t.is(await bundles.savedVersion(), '4.25.0')
  t.ok(b4a.equals(await read(root, 'app.bundle'), b4a.from([4])))
  t.absent(await exists(path.join(root, 'ota', 'assets')))
})

test('save rejects a version that is not semver and keeps what is stored', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root })

  await bundles.save(BUNDLE, '4.24.0')
  await bundles.apply()

  for (const version of ['latest', '4.24', '4.24.0.1', '', null]) {
    await t.exception(bundles.save(b4a.from([7]), version), /Invalid bundle version/)
  }

  t.is(await bundles.savedVersion(), '4.24.0')
  t.ok(b4a.equals(await read(root, 'app.bundle'), BUNDLE))
})

test('overlapping saves return compatibility and write only the newest compatible bundle', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root, currentVersion: '4.24.0' })

  const results = await Promise.all([
    bundles.save(b4a.from([1]), '4.24.0'),
    bundles.save(b4a.from([8]), '4.25.0', { minver: '4.25.0' }),
    bundles.save(b4a.from([2]), '4.25.0', { minver: '4.23.0' }),
    bundles.save(b4a.from([3]), '4.26.0', { minver: '4.24.0' }),
    bundles.save(b4a.from([9]), '4.27.0', { minver: '4.25.0' })
  ])
  t.alike(results, [true, false, true, true, false])
  await bundles.apply()

  t.is(await bundles.savedVersion(), '4.26.0')
  t.ok(b4a.equals(await read(root, 'app.bundle'), b4a.from([3])))
  t.absent(await exists(path.join(root, 'ota.tmp')), 'staging directory is gone')
})

test('apply does nothing without a newly staged bundle', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root })

  t.is(await bundles.apply(), false)
  await bundles.save(BUNDLE, '4.24.0')
  t.is(await bundles.apply(), true)
  t.is(await bundles.apply(), false)
  t.is(await bundles.savedVersion(), '4.24.0')
})

test('apply waits for an in-flight save', async (t) => {
  const root = await tmp(t)
  const io = require('#fs')
  const writing = deferred()
  const release = deferred()
  const bundles = new BundlePersist({
    root,
    fs: {
      ...io,
      async writeFile(target, data) {
        if (target.endsWith('app.bundle')) {
          writing.resolve()
          await release.promise
        }
        return io.writeFile(target, data)
      }
    }
  })

  const saving = bundles.save(BUNDLE, '4.24.0')
  await writing.promise
  const applying = bundles.apply()
  t.is(await bundles.savedVersion(), null)
  release.resolve()

  await saving
  t.is(await applying, true)
  t.is(await bundles.savedVersion(), '4.24.0')
})

test('apply stages and commits the latest waiting save', async (t) => {
  const root = await tmp(t)
  const io = require('#fs')
  const writing = deferred()
  const release = deferred()
  const staged = []
  const bundles = new BundlePersist({
    root,
    fs: {
      ...io,
      async writeFile(target, data) {
        if (target.endsWith('app.bundle')) {
          staged.push(data[0])
          if (data[0] === 1) {
            writing.resolve()
            await release.promise
          }
        }
        return io.writeFile(target, data)
      }
    }
  })

  const first = bundles.save(b4a.from([1]), '4.24.0')
  await writing.promise
  const applying = bundles.apply()
  const second = bundles.save(b4a.from([2]), '4.25.0')
  const latest = bundles.save(b4a.from([3]), '4.26.0')
  release.resolve()

  t.alike(await Promise.all([first, applying, second, latest]), [true, true, true, true])
  t.alike(staged, [1, 3])
  t.is(await bundles.savedVersion(), '4.26.0')
  t.ok(b4a.equals(await read(root, 'app.bundle'), b4a.from([3])))
  t.is(await bundles.apply(), false)
})

test('a save arriving during apply staging reports its own failure', async (t) => {
  const root = await tmp(t)
  const io = require('#fs')
  const writing = [deferred(), deferred()]
  const release = [deferred(), deferred()]
  const bundles = new BundlePersist({
    root,
    fs: {
      ...io,
      async writeFile(target, data) {
        if (target.endsWith('app.bundle')) {
          if (data[0] === 3) throw new Error('later save failed')
          writing[data[0] - 1].resolve()
          await release[data[0] - 1].promise
        }
        return io.writeFile(target, data)
      }
    }
  })

  const first = bundles.save(b4a.from([1]), '4.24.0')
  await writing[0].promise
  const applying = bundles.apply()
  const second = bundles.save(b4a.from([2]), '4.25.0')
  release[0].resolve()
  await writing[1].promise
  const latest = t.exception(bundles.save(b4a.from([3]), '4.26.0'), /later save failed/)
  release[1].resolve()

  t.alike(await Promise.all([first, applying, second]), [true, true, true])
  await latest
  t.is(await bundles.savedVersion(), '4.25.0')
  t.ok(b4a.equals(await read(root, 'app.bundle'), b4a.from([2])))
  t.is(await bundles.apply(), false)
})

test('concurrent applies commit a staged bundle only once', async (t) => {
  const root = await tmp(t)
  const io = require('#fs')
  const committing = deferred()
  const release = deferred()
  let commits = 0
  const bundles = new BundlePersist({
    root,
    fs: {
      ...io,
      async commitDir(from, to) {
        commits++
        committing.resolve()
        await release.promise
        return io.commitDir(from, to)
      }
    }
  })

  await bundles.save(BUNDLE, '4.24.0')
  const first = bundles.apply()
  await committing.promise
  const second = bundles.apply()
  release.resolve()

  t.alike(await Promise.all([first, second]), [true, false])
  t.is(commits, 1)
  t.is(await bundles.savedVersion(), '4.24.0')
})

test('apply and a queued save both report staging failure and recover', async (t) => {
  const root = await tmp(t)
  const io = require('#fs')
  const writing = deferred()
  const release = deferred()
  const bundles = new BundlePersist({
    root,
    fs: {
      ...io,
      async writeFile(target, data) {
        if (target.endsWith('app.bundle') && data[0] === 4) {
          writing.resolve()
          await release.promise
        }
        if (target.endsWith('app.bundle') && data[0] === 5) throw new Error('write failed')
        return io.writeFile(target, data)
      }
    }
  })

  await bundles.save(BUNDLE, '4.24.0', { assets: { 'assets/old.png': b4a.from([9]) } })
  await bundles.apply()
  const first = bundles.save(b4a.from([4]), '4.25.0')
  await writing.promise
  const applying = t.exception(bundles.apply(), /write failed/)
  const saving = t.exception(bundles.save(b4a.from([5]), '4.26.0'), /write failed/)
  release.resolve()
  await Promise.all([first, applying, saving])

  t.is(await bundles.apply(), false)
  t.is(await bundles.savedVersion(), '4.24.0')
  t.ok(b4a.equals(await read(root, 'assets/old.png'), b4a.from([9])))

  await bundles.save(b4a.from([6]), '4.27.0')
  t.is(await bundles.apply(), true)
  t.is(await bundles.savedVersion(), '4.27.0')
})

test('a save waits while apply commits the previous bundle', async (t) => {
  const root = await tmp(t)
  const io = require('#fs')
  const committing = deferred()
  const release = deferred()
  let applying = false
  let stagingDuringCommit = false
  const bundles = new BundlePersist({
    root,
    fs: {
      ...io,
      dirExists(target) {
        if (applying) stagingDuringCommit = true
        return io.dirExists(target)
      },
      async commitDir(from, to) {
        applying = true
        committing.resolve()
        await release.promise
        await io.commitDir(from, to)
        applying = false
      }
    }
  })

  await bundles.save(BUNDLE, '4.24.0')
  const first = bundles.apply()
  await committing.promise
  const saving = bundles.save(b4a.from([4]), '4.25.0')
  await Promise.resolve()
  t.absent(stagingDuringCommit)
  release.resolve()

  t.is(await first, true)
  await saving
  t.is(await bundles.savedVersion(), '4.24.0')
  t.ok(b4a.equals(await read(root, 'app.bundle'), BUNDLE))
  t.is(await bundles.apply(), true)
  t.is(await bundles.savedVersion(), '4.25.0')
})

test('a failed apply cannot swap the previous bundle back on retry', async (t) => {
  const root = await tmp(t)
  const io = require('#fs')
  let fail = false
  const bundles = new BundlePersist({
    root,
    fs: {
      ...io,
      async commitDir(from, to) {
        if (!fail) return io.commitDir(from, to)
        const previous = path.join(root, 'previous')
        await fs.rename(to, previous)
        await fs.rename(from, to)
        await fs.rename(previous, from)
        throw new Error('swap cleanup failed')
      }
    }
  })

  await bundles.save(BUNDLE, '4.24.0')
  await bundles.apply()
  await bundles.save(b4a.from([4]), '4.25.0')
  fail = true
  await t.exception(bundles.apply(), /swap cleanup failed/)
  t.is(await bundles.apply(), false)
  t.is(await bundles.savedVersion(), '4.25.0')
  t.ok(b4a.equals(await read(root, 'app.bundle'), b4a.from([4])))

  fail = false
  await bundles.save(b4a.from([5]), '4.26.0')
  t.is(await bundles.apply(), true)
  t.is(await bundles.savedVersion(), '4.26.0')
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
  await bundles.apply()
  await fs.rm(path.join(root, 'ota', 'manifest.json'))

  t.is(await bundles.savedVersion(), null)
})

test('savedVersion is null when the manifest is unusable', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root })

  await bundles.save(BUNDLE, '4.24.0')
  await bundles.apply()

  for (const manifest of ['{not json', '{}', JSON.stringify({ version: 'latest' })]) {
    await fs.writeFile(path.join(root, 'ota', 'manifest.json'), manifest)
    t.is(await bundles.savedVersion(), null, manifest)
  }
})

test('savedVersion is null when the bundle is missing', async (t) => {
  const root = await tmp(t)
  const bundles = new BundlePersist({ root })

  await bundles.save(BUNDLE, '4.24.0')
  await bundles.apply()
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
  await bundles.apply()

  const failing = {
    ...io,
    writeFile(target, data) {
      if (target.endsWith('manifest.json')) throw new Error('interrupted')
      return io.writeFile(target, data)
    }
  }

  const interrupted = new BundlePersist({ root, fs: failing })
  await t.exception(interrupted.save(b4a.from([4]), '4.25.0'), /interrupted/)
  t.is(await interrupted.apply(), false)

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

function deferred() {
  let resolve
  const promise = new Promise((res) => {
    resolve = res
  })
  return { promise, resolve }
}

test('default root follows the runtime', async (t) => {
  if (require('#fs') === require('../lib/fs.js')) {
    t.exception(() => new BundlePersist(), /No storage root/)
  } else {
    t.is(new BundlePersist().root, require('bare-storage').persistent())
  }
})

async function exists(target) {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
}
