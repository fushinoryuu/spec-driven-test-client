# Generator spike

Throwaway comparison behind [decision record 0002](../../docs/decisions/0002-generator.md). It is not part of the library, has its own `package.json`, and nothing outside this folder imports from it. The results and the decision are in the record.

It generates a client from [tests/fixtures/specs/generator-spike.yaml](../../tests/fixtures/specs/generator-spike.yaml) with five candidates, then for each one checks that two clean runs give identical output, counts the generated lines, typechecks the output under the library's strict `NodeNext` settings (with and without DOM types), and runs the same eight scenarios against a mock server.

## Run it

```sh
cd spikes/generator
npm ci
npm run spike                  # every candidate
npm run spike -- heyapi orval  # only these
```

The OpenAPI Generator candidates (`ogen-fetch`, `ogen-axios`) need Java 11 or newer (`java -version`). Without Java they are skipped. Output goes to `out/`, which is ignored by git, and `out/summary.json` holds the numbers.

`.npmrc` sets `legacy-peer-deps` because openapi-typescript 7.13 declares a peer dependency on TypeScript 5. The `js-yaml` override clears a high-severity advisory in hey-api's spec parser.

## Layout

| Path | What it is |
|---|---|
| `run.ts` | Generates, measures and prints the results for every candidate |
| `probes/` | The mock server, the shared scenario, one adapter per candidate, and the facade type check |
| `openapitools.json` | Pins the OpenAPI Generator version |
| `openapi-ts.config.mjs`, `orval.config.mjs` | Candidate configuration |
