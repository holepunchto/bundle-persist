# bundle-persist

Stage and atomically apply app bundles from Bare. Native app code chooses which bundle to boot; this module only persists the bundle, assets and version.

```sh
npm install bundle-persist
```

```js
const BundlePersist = require('bundle-persist')

const bundles = new BundlePersist({ currentVersion: '1.0.0' })
const compatible = await bundles.save(bundle, '1.1.0', {
  minver: '1.0.0',
  assets: { 'assets/logo.png': logoBytes }
})

if (compatible) {
  // When the user is ready, stop incoming saves and apply before restarting.
  await bundles.apply()
}
```

`bundle` and asset values are bytes. Asset keys are trusted paths relative to the bundle directory; preserve the paths generated with the bundle.

## API

- `new BundlePersist({ currentVersion, root })`: `currentVersion` is the installed native app's release version. `root` defaults to `bare-storage.persistent()`.
- `save(bundle, version, { minver, assets })`: stages files and returns `true`, or returns `false` without writing if the native version is below `minver`. `minver` and `assets` are optional. Invalid versions and filesystem failures reject.
- `isCompatible(minver)`: checks compatibility without writing. Supplying `minver` requires `currentVersion`; versions use SemVer precedence.
- `apply()`: waits for pending staging, then commits. Returns `false` if no new update is ready. It does not restart the app.
- `savedVersion()`: returns the applied version or `null`.

Set `minver` to the release version containing the native changes required by an update. An OTA JavaScript version does not change that baseline.

## Storage

```text
<root>/ota/
  app.bundle
  manifest.json    { "version": "1.1.0", "minver": "1.0.0" }
  assets/...
```

`save()` writes to `ota.tmp`, leaving the running bundle and assets untouched. `apply()` exchanges it with `ota` using `fs-native-extensions.swap()`; the first apply uses a rename. File writes and the surrounding directories are synced. All filesystem operations live in `lib/fs.js`.

Use one writer per root. Overlapping saves coalesce to the latest compatible update. Stop new saves before applying, then restart immediately because running code can still reference assets on disk. After a failed apply, save again before retrying. Unapplied state is kept in memory and must be supplied again after a process restart.

The native picker must read `ota/app.bundle` and `ota/manifest.json` under Application Support on iOS or `context.filesDir` on Android. It should select only an update newer than the shipped version and fall back to the shipped bundle when unavailable. No integrity checking or crash rollback is provided.

The constructor also accepts `otaDir`, `stagingDir`, `bundleFile` and `manifestFile` overrides, plus an `fs` adapter for tests. Keep overridden names aligned with native boot code.
