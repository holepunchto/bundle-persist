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
```

- **React Native** resolves the `expo-file-system` adapter and defaults the storage root to the documents directory.
- **Bare** resolves the `bare-fs` adapter and has no default root, so pass one: `new BundlePersist({ root })`.
- Tests pass their own adapter: `new BundlePersist({ fs, root })`.

### API

| Call | Result |
|---|---|
| `new BundlePersist({ root, fs })` | An instance bound to one storage directory. `otaDir`, `stagingDir`, `bundleFile` and `manifestFile` override the names below. |
| `await bundles.save(bundle, version, { assets })` | Writes the update. Rejects on a version that isn't semver. Saves never run in parallel, and when several are waiting only the newest bundle is written. |
| `await bundles.savedVersion()` | The stored version, or `null` when nothing complete is stored. |

## On-disk layout

```
<root>/ota/
├── app.bundle      the React Native bundle
├── assets/ …       whatever the bundle references
└── manifest.json   { "version": "4.24.0" }
```

`save` always builds the update in a staging directory and finishes it with `manifest.json`, so nothing incomplete can become the stored update. Promoting that directory is a single adapter call, `commitDir(from, to)`, and how much it guarantees depends on the runtime.

**Under Bare** the save is atomic and durable. Every file is fsynced as it is written, the staging directory's entries are fsynced before the swap, and the parent directory after it, so nothing about the new update can reach disk out of order. The two directories are exchanged with `fs-native-extensions`' `swap()`, a single atomic operation on macOS, Linux and Android. Across a crash or a power cut, the stored update is either entirely the old one or entirely the new one.

**Everywhere else** `commitDir` is a delete followed by a rename. The rename itself is atomic, so a reader never sees a mixture, but two gaps remain that `expo-file-system` cannot close: a crash between the two steps loses an update that was working, and nothing can be fsynced, so a power cut can leave a manifest that outlived the bundle it describes.

An adapter that provides an atomic `commitDir` gets the stronger guarantee; the rest of the module is identical either way.

The boot code in the app is expected to load `app.bundle` only when the version in `manifest.json` is newer than the installed app's, and to fall back to the shipped bundle on anything else, including a read error. Those names are that contract, so overriding them in JavaScript alone hides the update from the app.

## Not covered

- Integrity checks on the stored bundle.
