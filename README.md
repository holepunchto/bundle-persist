# bundle-persist

Stage and apply bundles and their assets from Bare. Bundle contents are opaque bytes; consumers choose how to load them and when to switch to an applied version.

```sh
npm install bundle-persist
```

For example, stage a Bare worker bundle:

```js
const fs = require('bare-fs/promises')
const BundlePersist = require('bundle-persist')

const bundles = new BundlePersist({
  currentVersion: '1.0.0',
  bundleFile: 'worker.bundle'
})

const compatible = await bundles.save(await fs.readFile('downloads/worker.bundle'), '1.1.0', {
  minver: '1.0.0',
  assets: { 'data/config.json': await fs.readFile('downloads/config.json') }
})
```

At a safe point, stop incoming saves and any worker using the existing files, then apply:

```js
if (compatible) await bundles.apply()
```

The consumer can then load the applied worker from `bundles.dir`. Loading, restarting and choosing a fallback bundle are the consumer's responsibility.

## API

- `new BundlePersist({ currentVersion, root })`: `currentVersion` is a SemVer compatibility baseline supplied by the consumer, such as the version of its host runtime. It is optional unless `minver` is used. `root` defaults to `bare-storage.persistent()`.
- `save(bundle, version, { minver, assets })`: stages the bundle, assets and manifest and returns `true`. Returns `false` without writing when `currentVersion` is below `minver`. `minver` and `assets` are optional. Invalid versions and filesystem failures reject.
- `isCompatible(minver)`: checks compatibility without writing. Versions use SemVer precedence; omitting `minver` returns `true`.
- `apply()`: waits for pending staging, then commits. Returns `true` when committed or `false` when no new bundle is ready. It does not load the bundle or restart anything.
- `savedVersion()`: returns the applied version, or `null` when the bundle or a valid manifest is unavailable.

`bundle` and asset values are bytes. Asset keys are trusted paths relative to the bundle directory; preserve the paths expected by the bundle. `minver` describes the compatibility baseline required by a bundle. Saving or applying a bundle does not change `currentVersion`.

## Storage

With the default constructor options:

```text
<root>/bundle_persist/
  app.bundle
  manifest.json    { "version": "1.1.0", "minver": "1.0.0" }
  assets/...
```

`save()` writes to `bundle_persist.tmp`, leaving the applied bundle and assets untouched. `apply()` exchanges it with `bundle_persist` using `fs-native-extensions.swap()`; the first apply uses a rename. File writes are synced on all platforms. The staging and parent directories are also synced except on Windows, where directory flushing is unsupported.

The exchange is atomic on macOS, iOS, Linux and Android. On Windows, [`fs-native-extensions.swap()`](https://github.com/holepunchto/fs-native-extensions#await-swapfrom-to) uses multiple moves and is not atomic.

The constructor accepts these overrides:

| Option         | Default                     |
| -------------- | --------------------------- |
| `root`         | `bare-storage.persistent()` |
| `payloadDir`   | `bundle_persist`            |
| `stagingDir`   | `bundle_persist.tmp`        |
| `bundleFile`   | `app.bundle`                |
| `manifestFile` | `manifest.json`             |

It also accepts an `fs` adapter matching `lib/fs.js`. Keep storage names aligned with the consumer that loads the files. Use one writer per root and separate roots for independent bundles.

Overlapping saves coalesce to the latest compatible save. Stop new saves before applying and coordinate active consumers so they do not read assets while their directory is replaced. After a failed apply, save again before retrying. Staged files are not automatically recovered after a process restart; save again before applying. Integrity checks and crash rollback are left to the consumer.

## Metro bundles

A React Native app can persist a Metro bundle and its assets with this module, using the installed native version as `currentVersion` and the native version required by the update as `minver`. Preserve Metro's relative asset paths and align the native bundle picker with the storage options. Apply at a safe point and reload React Native to use the new files.

For example, read a downloaded platform folder from Bare using `localdrive` and `which-runtime`. Each folder contains `app.bundle`, `package.json` with `version` and `minver`, and the assets emitted by Metro:

```js
const Localdrive = require('localdrive')
const { isIOS } = require('which-runtime')
const BundlePersist = require('bundle-persist')

const bundles = new BundlePersist({ currentVersion: '1.0.0' })
const drive = new Localdrive(isIOS ? 'downloads/ios' : 'downloads/android')
await drive.ready()
const { version, minver } = JSON.parse(await drive.get('/package.json'))
const assets = Object.create(null)

for await (const { key, value } of drive.list('/')) {
  if (!value.blob || key === '/app.bundle' || key === '/package.json') continue
  assets[key.slice(1)] = await drive.get(key)
}

const compatible = await bundles.save(await drive.get('/app.bundle'), version, {
  minver,
  assets
})
await drive.close()
```

The installed native version above is `1.0.0`. If `compatible` is `false`, tell the frontend that a native app update is required. Otherwise, the bundle and assets are staged while React Native continues running.

When the user chooses Apply, run this in Bare:

```js
if (compatible) await bundles.apply()
```

When `apply()` returns `true`, notify React Native over IPC and reload it immediately. The native picker should read `bundle_persist/app.bundle` and `bundle_persist/manifest.json` from the same persistent root. Keep the downloaded source folder separate from `bundle_persist` and `bundle_persist.tmp`.

See [bundle-persist-showcase](https://github.com/holepunchto/bundle-persist-showcase) for an Expo example and its Android and iOS native patch.

## Tests

Run `npm test` with Bare installed. CI runs the same suite on Linux, macOS, Windows, an iOS simulator and an Android emulator. Mobile jobs bundle the tests with `bare-pack` and execute them in the native Bare runtime supplied by `bare-run`.
