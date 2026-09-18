# bundle-persist

Persists a downloaded React Native bundle on disk, in the layout an app's native boot code reads. Works from Bare and from React Native: the file API is picked through the runtime's import conditions.

Choosing between the stored bundle and the one shipped inside the app is the app's own native code; this module only writes and reads the files.

## Install

```sh
npm install bundle-persist
```

## Usage

```js
const BundlePersist = require('bundle-persist')

const bundles = new BundlePersist()

await bundles.save(bundle, '4.24.0', { assets })

// When ready to restart the app:
if (await bundles.apply()) await restartApp()
```

`restartApp()` is supplied by the app. `save()` only stages the update and leaves the active bundle and assets untouched. Call `apply()` immediately before restarting: it replaces the files that the running bundle may still reference.

- **React Native** resolves the `expo-file-system` adapter and defaults to Application Support on iOS and the app's files directory on Android.
- **Bare** resolves the `bare-fs` adapter and defaults to `require('bare-storage').persistent()`.
- **Node.js** requires an explicit root: `new BundlePersist({ root })`.
- Tests pass their own adapter: `new BundlePersist({ fs, root })`.

The mobile defaults target the same app directory from both runtimes: `<sandbox>/Library/Application Support` on iOS and the app's `filesDir` on Android. Bare uses filesystem paths; Expo uses `file://` URIs. An explicit `root` overrides the default.

The app's native boot code must use `.applicationSupportDirectory` on iOS and `context.filesDir` on Android, with `ota/app.bundle` and `ota/manifest.json` below that root. Existing files in iOS Documents are not moved automatically.

### API

| Call                                              | Result                                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new BundlePersist({ root, fs })`                 | An instance bound to one storage directory. `otaDir`, `stagingDir`, `bundleFile` and `manifestFile` override the names below.                              |
| `await bundles.save(bundle, version, { assets })` | Stages the update without applying it. Rejects on a version that isn't semver. Saves never run in parallel, and waiting saves coalesce to the latest call. |
| `await bundles.apply()`                           | Waits for staging, then commits the staged update. Returns `true` when applied, or `false` when no complete update is pending.                             |
| `await bundles.savedVersion()`                    | The applied version available to native boot, or `null` when nothing complete is applied. Staging does not change it.                                      |

## On-disk layout

```
<root>/ota/
├── app.bundle      the React Native bundle
├── assets/ …       whatever the bundle references
└── manifest.json   { "version": "4.24.0" }
```

`save()` builds the update in `<root>/ota.tmp/` and finishes it with `manifest.json`. Only `apply()` promotes that directory to `<root>/ota/` through the adapter's `commitDir(from, to)` method. Native boot continues reading the applied directory until then.

Staging and commits share one queue, so a save cannot modify the staging directory during a commit. Saves received before the commit runs can replace the pending update. `apply()` does not restart the app; the caller controls that step. Use one writer instance per root, and stop accepting new updates when beginning the restart flow.

Failures reject the operation's promise without blocking later operations. An unsuccessful staging operation cannot be applied. After a failed commit, save the bundle again before retrying `apply()`: a filesystem adapter may have already moved the directories before reporting an error. Pending state is in memory; after a process restart, an unapplied update must be supplied again.

**Under Bare** applying uses the atomic swap adapter. Files are fsynced during staging, the staging directory before the swap, and the parent directory afterward. Existing directories are exchanged with `fs-native-extensions`' `swap()`; the first apply uses a rename.

**Everywhere else** `commitDir` is a delete followed by a rename. The rename itself is atomic, so a reader never sees a mixture, but two gaps remain that `expo-file-system` cannot close: a crash between the two steps loses an update that was working, and nothing can be fsynced, so a power cut can leave a manifest that outlived the bundle it describes.

An adapter that provides an atomic `commitDir` gets the stronger guarantee; the rest of the module is identical either way.

The boot code in the app is expected to load `app.bundle` only when the version in `manifest.json` is newer than the installed app's, and to fall back to the shipped bundle on anything else, including a read error. Those names are that contract, so overriding them in JavaScript alone hides the update from the app.

## Not covered

- Integrity checks on the stored bundle.
