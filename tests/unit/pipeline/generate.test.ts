import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkSpec, formatSummary, generate, GenerateError, runCli, UsageError, type GenerateOptions } from '../../../scripts/generate.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'specs');

/** Most tests skip `tsc`, which takes seconds. The "compiles" tests run it. */
const skipTypecheck = async () => {};

/** Every test works in a folder inside the repository, because the typecheck needs its `node_modules`. `.generate-*` is gitignored. */
let work: string;
let specsDir: string;
let outDir: string;

beforeEach(async () => {
    work = await mkdtemp(path.join(ROOT, '.generate-test-'));
    specsDir = path.join(work, 'specs');
    outDir = path.join(work, 'out');
    await mkdir(specsDir);
});

afterEach(async () => {
    await rm(work, { recursive: true, force: true });
});

async function addFixture(fixture: string, as = fixture): Promise<void> {
    await cp(path.join(FIXTURES, fixture), path.join(specsDir, as));
}

async function addSpec(name: string, text: string): Promise<void> {
    await writeFile(path.join(specsDir, name), text);
}

/** A stand-in for the library's root, with its own `tsconfig.json`, config, `node_modules` and `specs/`. `compilerOptions` change what the typecheck accepts. */
async function makeRoot(name: string, compilerOptions: object = {}): Promise<string> {
    const root = path.join(work, name);
    await mkdir(path.join(root, 'specs'), { recursive: true });
    await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ extends: path.join(ROOT, 'tsconfig.json'), compilerOptions }));
    await cp(path.join(ROOT, 'openapi-ts.config.mjs'), path.join(root, 'openapi-ts.config.mjs'));
    await symlink(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'), 'junction');
    return root;
}

/** The work folders of a run that were not removed. The folders of the tests themselves are not counted. */
async function leftoverWorkFolders(): Promise<string[]> {
    return (await readdir(ROOT)).filter((entry) => entry.startsWith('.generate-') && !entry.startsWith('.generate-test-'));
}

/** Every file under a folder, keyed by its relative path. */
async function readTree(folder: string): Promise<Map<string, string>> {
    const tree = new Map<string, string>();
    for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
        if (entry.isFile()) {
            const file = path.join(entry.parentPath, entry.name);
            tree.set(path.relative(folder, file).split(path.sep).join('/'), await readFile(file, 'utf8'));
        }
    }
    return tree;
}

async function run(options: Partial<GenerateOptions> = {}) {
    return generate({ root: ROOT, specsDir, outDir, typecheck: skipTypecheck, ...options });
}

async function failure(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        return error as Error;
    }
    throw new Error('Expected the run to fail, but it passed.');
}

/** A spec with the operations it is given, each `GET /v1/<id>`. */
function specWith(...operations: string[]): string {
    const paths = operations.map((id) => `  /v1/${id}:\n    get:\n      operationId: ${id}\n      tags: [things]\n      responses:\n        '200':\n          description: Done.\n`).join('');
    return `openapi: 3.0.3\ninfo:\n  title: Things\n  version: 0.1.0\npaths:\n${paths}`;
}

describe('checkSpec', () => {
    it('counts the operations', () => {
        expect(checkSpec('things.yaml', specWith('getThing', 'listThings'))).toEqual({ operations: 2, problems: [] });
    });

    it('reports a duplicate operationId with both places', () => {
        const text = specWith('getThing').replace('paths:\n', 'paths:\n  /v1/other:\n    get:\n      operationId: getThing\n      responses:\n        "200":\n          description: Done.\n');
        const { problems } = checkSpec('things.yaml', text);
        expect(problems).toEqual(['things.yaml: operationId "getThing" is used by GET /v1/other and by GET /v1/getThing. Every operation needs its own.']);
    });

    it('reports a $ref that does not exist, and where it is', () => {
        const text = specWith('getThing').replace('description: Done.\n', "description: Done.\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/Missing'\n");
        const { problems } = checkSpec('things.yaml', text);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('"#/components/schemas/Missing" does not exist');
        expect(problems[0]).toContain('paths./v1/getThing.get.responses.200.content.application/json.schema');
    });

    it('resolves a $ref with an escaped or encoded key', () => {
        const text = `openapi: 3.0.3\ninfo: {title: t, version: '1'}\npaths:\n  /a:\n    get:\n      responses:\n        '200':\n          description: Done.\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/a~1b%20c'\ncomponents:\n  schemas:\n    a/b c:\n      type: string\n`;
        expect(checkSpec('things.yaml', text).problems).toEqual([]);
    });

    it('reports YAML that cannot be read, and a file that is not OpenAPI', () => {
        expect(checkSpec('things.yaml', 'paths: [\n').problems[0]).toMatch(/^things\.yaml is not valid YAML \(/);
        expect(checkSpec('things.yaml', 'title: nothing\n').problems).toEqual(['things.yaml is not an OpenAPI document (it needs "openapi" and "paths").']);
    });
});

describe('generate', () => {
    it('generates each spec into its own folder, named after the file', async () => {
        await addFixture('widgets-service-v0.yaml');
        await addFixture('widgets-service-v1.yaml');
        const result = await run();

        expect(result.generated.map((spec) => spec.name)).toEqual(['widgets-service-v0', 'widgets-service-v1']);
        expect(result.removed).toEqual([]);
        expect((await readdir(outDir)).sort()).toEqual(['widgets-service-v0', 'widgets-service-v1']);
        const v1 = await readTree(path.join(outDir, 'widgets-service-v1'));
        expect([...v1.keys()]).toEqual(expect.arrayContaining(['index.ts', 'sdk.gen.ts', 'types.gen.ts', 'client.gen.ts', 'client/client.gen.ts', 'core/types.gen.ts']));
        expect(v1.get('sdk.gen.ts')).toContain('getWidget');
    });

    it('starts every generated file with the generator header, and imports with a .js extension', async () => {
        await addFixture('widgets-service-v1.yaml');
        await run();
        const tree = await readTree(path.join(outDir, 'widgets-service-v1'));
        for (const [file, content] of tree) {
            expect(content.startsWith('// This file is auto-generated by @hey-api/openapi-ts'), file).toBe(true);
        }
        expect(tree.get('index.ts')).toContain("from './sdk.gen.js'");
    });

    it('is deterministic: two runs give identical files', async () => {
        await addFixture('widgets-service-v0.yaml');
        await addFixture('widgets-service-v1.yaml');
        await addFixture('generator-spike.yaml', 'spike.yaml');
        const second = path.join(work, 'out-2');
        await run();
        await run({ outDir: second });

        const first = await readTree(outDir);
        expect(first.size).toBeGreaterThan(30);
        expect(await readTree(second)).toEqual(first);
    });

    it('generates a spec that is just dropped in, with no change to any script or configuration', async () => {
        await addFixture('widgets-service-v1.yaml');
        await addSpec('gadgets-service-v7.yaml', specWith('getGadget'));
        const result = await run();
        expect(result.generated.map((spec) => spec.name)).toEqual(['gadgets-service-v7', 'widgets-service-v1']);
        expect((await readTree(path.join(outDir, 'gadgets-service-v7'))).get('sdk.gen.ts')).toContain('getGadget');
    });

    it('removes an operation that was removed from the spec', async () => {
        await addSpec('things-service-v1.yaml', specWith('getThing', 'listThings'));
        await run();
        const before = await readTree(path.join(outDir, 'things-service-v1'));
        expect(before.get('sdk.gen.ts')).toContain('listThings');
        expect(before.get('types.gen.ts')).toContain('ListThingsData');

        await addSpec('things-service-v1.yaml', specWith('getThing'));
        await run();
        const after = await readTree(path.join(outDir, 'things-service-v1'));
        expect(after.get('sdk.gen.ts')).toContain('getThing');
        for (const [file, content] of after) {
            expect(content, file).not.toMatch(/listThings|ListThings/);
        }
    });

    it('removes a file that an earlier run left in the spec folder', async () => {
        await addFixture('widgets-service-v1.yaml');
        await run();
        await writeFile(path.join(outDir, 'widgets-service-v1', 'stale.gen.ts'), '// stale\n');
        await run();
        expect((await readTree(path.join(outDir, 'widgets-service-v1'))).has('stale.gen.ts')).toBe(false);
    });

    it('removes the folder of a spec that no longer exists, in a full run only', async () => {
        await addFixture('widgets-service-v0.yaml');
        await addFixture('widgets-service-v1.yaml');
        await run();

        await rm(path.join(specsDir, 'widgets-service-v0.yaml'));
        const single = await run({ service: 'widgets-service-v1' });
        expect(single.removed).toEqual([]);
        expect((await readdir(outDir)).sort()).toEqual(['widgets-service-v0', 'widgets-service-v1']);

        const full = await run();
        expect(full.removed).toEqual(['widgets-service-v0']);
        expect(await readdir(outDir)).toEqual(['widgets-service-v1']);
    });

    describe('--service', () => {
        it('generates only the named spec and leaves the other folders alone', async () => {
            await addFixture('widgets-service-v0.yaml');
            await addFixture('widgets-service-v1.yaml');
            await run();
            const v0Before = await readTree(path.join(outDir, 'widgets-service-v0'));
            await rm(path.join(outDir, 'widgets-service-v1'), { recursive: true });

            const result = await run({ service: 'widgets-service-v1' });
            expect(result.generated.map((spec) => spec.name)).toEqual(['widgets-service-v1']);
            expect((await readdir(outDir)).sort()).toEqual(['widgets-service-v0', 'widgets-service-v1']);
            expect(await readTree(path.join(outDir, 'widgets-service-v0'))).toEqual(v0Before);
        });

        it('fails with a readable message for a name that is not a spec', async () => {
            await addFixture('widgets-service-v1.yaml');
            const error = await failure(run({ service: 'widgets-service-v9' }));
            expect(error).toBeInstanceOf(UsageError);
            expect(error.message).toContain('There is no spec named "widgets-service-v9"');
            expect(error.message).toContain('widgets-service-v1');
        });
    });

    describe('a spec that cannot be generated', () => {
        /** A good spec is generated first, so each case can show that its folder is still there, unchanged. */
        async function withExistingOutput(): Promise<Map<string, string>> {
            await addFixture('widgets-service-v1.yaml');
            await run();
            return readTree(outDir);
        }

        it.each([
            ['malformed YAML', 'broken-service-v1.yaml', 'openapi: 3.0.3\npaths: [\n', 'broken-service-v1.yaml is not valid YAML'],
            [
                'a $ref that does not exist',
                'dangling-service-v1.yaml',
                specWith('getThing').replace('description: Done.\n', "description: Done.\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/Missing'\n"),
                '"#/components/schemas/Missing" does not exist'
            ],
            ['a duplicate operationId', 'twice-service-v1.yaml', specWith('getThing').replace('paths:\n', 'paths:\n  /v1/again:\n    get:\n      operationId: getThing\n      responses:\n        "200":\n          description: Done.\n'), 'operationId "getThing" is used by'],
            ['a spec that hey-api rejects', 'old-service-v1.yaml', "openapi: 2.0\ninfo: {title: t, version: '1'}\npaths: {}\n", 'old-service-v1.yaml: hey-api reported: Invalid version'],
            ['a file name that is not a spec name', 'Not A Spec.yaml', specWith('getThing'), 'the name must be lower case letters, digits and dashes']
        ])('fails for %s with a useful message, and the existing output is untouched', async (_label, file, text, expected) => {
            const before = await withExistingOutput();
            await addSpec(file, text);

            const error = await failure(run());
            expect(error).toBeInstanceOf(GenerateError);
            expect(error.message).toContain(expected);
            expect(await readTree(outDir)).toEqual(before);
        });

        it('reports every problem together', async () => {
            await addSpec('one-service-v1.yaml', 'paths: [\n');
            await addSpec('two-service-v1.yaml', 'title: nothing\n');
            const error = await failure(run());
            expect(error.message).toContain('2 problems found');
            expect(error.message).toContain('one-service-v1.yaml is not valid YAML');
            expect(error.message).toContain('two-service-v1.yaml is not an OpenAPI document');
        });

        it('does not write a crash log into the working directory', async () => {
            await addSpec('old-service-v1.yaml', "openapi: 2.0\ninfo: {title: t, version: '1'}\npaths: {}\n");
            await failure(run());
            expect((await readdir(ROOT)).filter((entry) => entry.startsWith('openapi-ts-error'))).toEqual([]);
        });

        it('fails when the typecheck fails, and the existing output is untouched', async () => {
            const before = await withExistingOutput();
            await addSpec('things-service-v1.yaml', specWith('getThing'));

            const error = await failure(run({ typecheck: () => Promise.reject(new GenerateError(['The generated code does not compile: nope'])) }));
            expect(error.message).toContain('does not compile');
            expect(await readTree(outDir)).toEqual(before);
        });

        it('leaves no work folder behind, after a pass or a failure', async () => {
            await addFixture('widgets-service-v1.yaml');
            await run();
            await addSpec('dup-service-v1.yaml', specWith('a').replace('paths:\n', 'paths:\n  /v1/b:\n    get:\n      operationId: a\n      responses:\n        "200":\n          description: x\n'));
            await failure(run());
            await rm(path.join(specsDir, 'dup-service-v1.yaml'));
            await addSpec('old-service-v1.yaml', "openapi: 2.0\ninfo: {title: t, version: '1'}\npaths: {}\n");
            await failure(run());
            expect(await leftoverWorkFolders()).toEqual([]);
        });
    });

    it('puts the old folders back when a move fails part way', async () => {
        await addSpec('a-service-v1.yaml', specWith('getA'));
        await addSpec('b-service-v1.yaml', specWith('getB'));
        // The old `a` is moved aside and the new `a` moved in. Then the new `b` cannot replace a file, so the swap fails and must undo the first move.
        await mkdir(path.join(outDir, 'a-service-v1'), { recursive: true });
        await writeFile(path.join(outDir, 'a-service-v1', 'old.ts'), '// old a\n');
        await writeFile(path.join(outDir, 'b-service-v1'), 'not a folder\n');

        await expect(run()).rejects.toThrow();

        expect(await readdir(path.join(outDir, 'a-service-v1'))).toEqual(['old.ts']);
        expect(await readFile(path.join(outDir, 'a-service-v1', 'old.ts'), 'utf8')).toBe('// old a\n');
        expect(await readFile(path.join(outDir, 'b-service-v1'), 'utf8')).toBe('not a folder\n');
        expect((await readdir(outDir)).sort()).toEqual(['a-service-v1', 'b-service-v1']);
        expect(await leftoverWorkFolders()).toEqual([]);
    });

    it('fails when there is nothing to generate', async () => {
        expect((await failure(run())).message).toContain('There are no .yaml specs');
        expect((await failure(run({ specsDir: path.join(work, 'missing') }))).message).toContain('does not exist');
    });

    it('typechecks the generated code under the repository settings', async () => {
        await addFixture('widgets-service-v0.yaml');
        await addFixture('widgets-service-v1.yaml');
        await addFixture('widgets-service-v2.yaml');
        const result = await generate({ root: ROOT, specsDir, outDir });
        expect(result.generated).toHaveLength(3);
    }, 60_000);

    it('refuses code that does not compile, with the file and the error', async () => {
        await addFixture('widgets-service-v1.yaml');
        // Without DOM the generated client has no `BodyInit`, so a tsconfig that drops it must fail the typecheck.
        const noDom = await makeRoot('root', { lib: ['ES2023'] });

        const error = await failure(generate({ root: noDom, specsDir, outDir }));
        expect(error).toBeInstanceOf(GenerateError);
        expect(error.message).toContain('The generated code does not compile');
        expect(error.message).toMatch(/widgets-service-v1[\\/]client[\\/]client\.gen\.ts\(\d+,\d+\): error TS/);
    }, 60_000);
});

describe('the committed clients', () => {
    const SURFACE: [string, string, string][] = [
        ['customers-service-v0', 'Operations', 'getVersion'],
        ['orders-service-v0', 'Operations', 'getVersion'],
        ['shipping-service-v0', 'Operations', 'getVersion'],
        ['customers-service-v1', 'Customers', 'createCustomer'],
        ['orders-service-v1', 'Orders', 'createOrder'],
        ['shipping-service-v1', 'Shipments', 'getShipment']
    ];

    it.each(SURFACE)('%s exposes %s.%s', async (folder, tag, operation) => {
        const module = (await import(`../../../src/generated/${folder}/index.ts`)) as Record<string, Record<string, unknown>>;
        expect(typeof module[tag]?.[operation]).toBe('function');
    });

    it('has a folder for every spec in specs/, and nothing else', async () => {
        const specs = (await readdir(path.join(ROOT, 'specs'))).filter((file) => file.endsWith('.yaml')).map((file) => file.slice(0, -'.yaml'.length));
        expect((await readdir(path.join(ROOT, 'src', 'generated'))).sort()).toEqual(specs.sort());
    });

    it('has identical runtime copies in every folder (decision 0011)', async () => {
        const folders = await readdir(path.join(ROOT, 'src', 'generated'));
        const runtime = async (folder: string) => {
            const tree = await readTree(path.join(ROOT, 'src', 'generated', folder));
            return [...tree].filter(([file]) => file.startsWith('client/') || file.startsWith('core/'));
        };
        const first = await runtime(folders[0]);
        expect(first.length).toBeGreaterThan(5);
        for (const folder of folders.slice(1)) {
            expect(await runtime(folder), folder).toEqual(first);
        }
    });
});

describe('formatSummary and runCli', () => {
    it('prints the specs, the operations per spec and the generator version', () => {
        const text = formatSummary({
            generated: [
                { name: 'orders-service-v1', operations: 5, folder: 'src/generated/orders-service-v1' },
                { name: 'a-service-v0', operations: 1, folder: 'src/generated/a-service-v0' }
            ],
            removed: ['old-service-v1'],
            generatorVersion: '0.99.0'
        });
        expect(text).toBe(['Generated 2 specs with @hey-api/openapi-ts 0.99.0.', '  orders-service-v1   5 operations  src/generated/orders-service-v1/', '  a-service-v0        1 operation   src/generated/a-service-v0/', '  removed old-service-v1/ (no spec of that name)'].join('\n'));
    });

    describe('exit codes', () => {
        let log: ReturnType<typeof vi.spyOn>;
        let error: ReturnType<typeof vi.spyOn>;
        beforeEach(() => {
            log = vi.spyOn(console, 'log').mockImplementation(() => {});
            error = vi.spyOn(console, 'error').mockImplementation(() => {});
        });
        afterEach(() => {
            vi.restoreAllMocks();
        });

        /** A library root with the given Storefront-style fixtures in its own `specs/`. */
        async function rootWith(name: string, ...fixtures: string[]): Promise<string> {
            const root = await makeRoot(name);
            for (const fixture of fixtures) {
                await cp(path.join(FIXTURES, fixture), path.join(root, 'specs', fixture));
            }
            return root;
        }

        it('returns 0 and prints the summary after a run', async () => {
            const root = await rootWith('cli-pass', 'widgets-service-v1.yaml');

            expect(await runCli({ root, argv: [], typecheck: skipTypecheck })).toBe(0);

            expect(error).not.toHaveBeenCalled();
            expect(log).toHaveBeenCalledTimes(1);
            const text = String(log.mock.calls[0][0]);
            expect(text).toMatch(/^Generated 1 spec with @hey-api\/openapi-ts \d+\.\d+\.\d+\.\n/);
            expect(text).toMatch(/widgets-service-v1\s+1 operation\s+src\/generated\/widgets-service-v1\/$/);
            expect((await readTree(path.join(root, 'src', 'generated', 'widgets-service-v1'))).get('sdk.gen.ts')).toContain('getWidget');
        });

        it('returns 1 and prints the problem when a spec is bad, and writes no output', async () => {
            const root = await rootWith('cli-fail', 'widgets-service-v1.yaml');
            await writeFile(path.join(root, 'specs', 'twice-service-v1.yaml'), specWith('getThing').replace('paths:\n', 'paths:\n  /v1/again:\n    get:\n      operationId: getThing\n      responses:\n        "200":\n          description: Done.\n'));

            expect(await runCli({ root, argv: [], typecheck: skipTypecheck })).toBe(1);

            expect(log).not.toHaveBeenCalled();
            const text = String(error.mock.calls[0][0]);
            expect(text).toContain('generate failed. src/generated/ was not changed.');
            expect(text).toContain('operationId "getThing" is used by');
            await expect(readdir(path.join(root, 'src', 'generated'))).rejects.toThrow();
        });

        it('returns 1 when the generated code does not compile', async () => {
            const root = await rootWith('cli-types', 'widgets-service-v1.yaml');

            expect(await runCli({ root, argv: [], typecheck: () => Promise.reject(new GenerateError(['The generated code does not compile: nope'])) })).toBe(1);

            expect(String(error.mock.calls[0][0])).toContain('The generated code does not compile: nope');
            await expect(readdir(path.join(root, 'src', 'generated'))).rejects.toThrow();
        });

        it('returns 2 for an option it does not know', async () => {
            expect(await runCli({ root: ROOT, argv: ['--bogus'], typecheck: skipTypecheck })).toBe(2);
            expect(String(error.mock.calls[0][0])).toContain('Usage: npm run generate');
        });

        it('returns 2 for an unknown --service, and does not touch src/generated', async () => {
            const before = await readTree(path.join(ROOT, 'src', 'generated'));
            expect(await runCli({ root: ROOT, argv: ['--service', 'nope-service-v1'], typecheck: skipTypecheck })).toBe(2);
            expect(String(error.mock.calls[0][0])).toContain('There is no spec named "nope-service-v1"');
            expect(await readTree(path.join(ROOT, 'src', 'generated'))).toEqual(before);
            expect(log).not.toHaveBeenCalled();
        });
    });
});
