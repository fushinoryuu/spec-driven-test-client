# Spec states for the demo

The specs of each state of the Storefront that the library demo goes through. The Phase 5 scripted demo replays them, and [docs/demo-script.md](../../docs/demo-script.md) records what each step does to the generated clients.

These files are not input to `npm run generate`. That reads `specs/`, which holds what the backend publishes now. Nothing here is copied by `npm run copy-specs`.

## Where the files come from

The backend has not released its 1.0.0 specs, so `1-baseline` is the six files of `specs/` at the time of ALP-15 (`info.version` 0.3.0 for the `v1` orders and customers specs, 0.2.0 for the others). The other states apply the edits in the backend's `docs/spec-change-notes.md` to those files by hand. The files are bundles, so a shared response is a local `$ref` such as `#/components/responses/Forbidden`, and not the path into the backend's shared file that the notes use. When the backend publishes the real 1.1.0 and `v2` bundles, replace these files with them and run the steps in the demo script again.

## States

A state is the folders up to it, laid over each other in order. A file in a later folder replaces the file of the same name.

| State          | Folders to lay over, in order          | Files to delete afterwards | Specs |
| -------------- | -------------------------------------- | -------------------------- | ----- |
| `1-baseline`   | `1-baseline`                           | none                       | 6     |
| `2-v1.1.0`     | `1-baseline`, `2-v1.1.0`               | none                       | 6     |
| `3-v2-added`   | `1-baseline`, `2-v1.1.0`, `3-v2-added` | none                       | 8     |
| `4-v1-retired` | `1-baseline`, `2-v1.1.0`, `3-v2-added` | `orders-service-v1.yaml`   | 7     |

`4-v1-retired` has no folder, because its only change is a removal.

| Folder       | Files                                                                             | What changed                                                                                                          |
| ------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `1-baseline` | the six specs of `specs/`                                                         | Nothing. It is the starting point.                                                                                    |
| `2-v1.1.0`   | `customers-service-v1.yaml`, `orders-service-v1.yaml`, `shipping-service-v1.yaml` | `info.version` 1.1.0. Optional `preferredLanguage`, a timeline route, optional `notes`, an optional `carrier` filter. |
| `3-v2-added` | `orders-service-v2.yaml`, `shipping-service-v2.yaml`                              | New files. A copy of the 1.1.0 `v1` spec with `/v2` paths and `info.version` 2.0.0, plus the two breaking edits.      |

## Generate a state

Lay the folders over each other in a scratch folder and generate into another one. `src/generated/` is not touched.

```sh
STATE=$(mktemp -d)
cp demo/specs/1-baseline/*.yaml demo/specs/2-v1.1.0/*.yaml "$STATE"
node --input-type=module -e "import { generate, formatSummary } from './scripts/generate.ts'; console.log(formatSummary(await generate({ root: process.cwd(), specsDir: process.argv[1], outDir: process.argv[2] })));" "$STATE" "$STATE-out"
```

Add the folder of a later state to the `cp` line, and delete `orders-service-v1.yaml` from `$STATE` for `4-v1-retired`. The output is in `$STATE-out/<spec name>/`. To see what a step changed, generate the state before it too and run `diff -ru` on the two output folders. A full run into a folder that already holds the previous state also removes the folder of a spec that is gone, which is how a retired version leaves the output.
