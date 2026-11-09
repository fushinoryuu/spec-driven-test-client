import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopySpecsError, copySpecs, formatSummary, parseConfig, type ServiceSource } from '../../scripts/copy-specs.js';

// Only the rollback test replaces rename. Every other test uses the real one.
vi.mock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();
    return { ...actual, rename: vi.fn(actual.rename) };
});

const ORDERS_V1 = 'orders-service-v1.yaml';
const SHIPPING_V1 = 'shipping-service-v1.yaml';

function spec(version: string, openapi = '3.0.3'): string {
    return `openapi: ${openapi}\ninfo:\n  title: Test service\n  version: ${version}\npaths: {}\n`;
}

/** A library folder with sibling service repositories beside it, all inside one temporary parent folder. */
let parent: string;
let root: string;

beforeEach(async () => {
    parent = await mkdtemp(path.join(tmpdir(), 'copy-specs-test-'));
    root = path.join(parent, 'library');
    await mkdir(root);
});

afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
});

async function write(file: string, content: string | Buffer): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
}

async function writeConfig(services: ServiceSource[]): Promise<void> {
    await write(path.join(root, 'specs.config.json'), JSON.stringify({ services }));
}

function service(files: string[], repo = 'service-repo', specsPath = 'specs'): ServiceSource {
    return { repo, specsPath, files };
}

/** Every file under a folder as relative path to content, so a run can be compared with what was there before. */
async function snapshot(folder: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    let entries: string[];
    try {
        entries = await readdir(folder, { recursive: true });
    } catch {
        return result;
    }
    for (const entry of entries.sort()) {
        try {
            result[entry.replaceAll('\\', '/')] = (await readFile(path.join(folder, entry))).toString('hex');
        } catch {
            result[entry.replaceAll('\\', '/')] = '(folder)';
        }
    }
    return result;
}

async function leftovers(): Promise<string[]> {
    return (await readdir(root)).filter((entry) => entry.startsWith('.copy-specs-'));
}

async function run() {
    return copySpecs({ root });
}

describe('copySpecs', () => {
    it('replaces the contents of specs/ with the listed files, byte for byte', async () => {
        await write(path.join(parent, 'service-repo', 'specs', ORDERS_V1), spec('1.2.0'));
        await write(path.join(parent, 'service-repo', 'specs', SHIPPING_V1), spec('0.1.1'));
        await writeConfig([service([ORDERS_V1, SHIPPING_V1])]);

        const result = await run();

        expect(await readFile(path.join(root, 'specs', ORDERS_V1), 'utf8')).toBe(spec('1.2.0'));
        expect(await readFile(path.join(root, 'specs', SHIPPING_V1), 'utf8')).toBe(spec('0.1.1'));
        expect(result.added.map((file) => file.name)).toEqual([ORDERS_V1, SHIPPING_V1]);
        expect(await leftovers()).toEqual([]);
        expect(await readdir(path.join(root, 'specs'))).not.toContain('sources.json');
    });

    it('copies files from several repositories and spec folders', async () => {
        await write(path.join(parent, 'first-repo', 'api', ORDERS_V1), spec('1.0.0'));
        await write(path.join(parent, 'second-repo', 'docs', 'specs', SHIPPING_V1), spec('2.0.0'));
        await writeConfig([service([ORDERS_V1], 'first-repo', 'api'), service([SHIPPING_V1], 'second-repo', 'docs/specs')]);

        await run();

        expect(await readdir(path.join(root, 'specs'))).toEqual([ORDERS_V1, SHIPPING_V1]);
    });

    it('copies a file with Windows line endings unchanged', async () => {
        const content = Buffer.from(spec('1.0.0').replaceAll('\n', '\r\n'), 'utf8');
        await write(path.join(parent, 'service-repo', 'specs', ORDERS_V1), content);
        await writeConfig([service([ORDERS_V1])]);

        await run();

        expect((await readFile(path.join(root, 'specs', ORDERS_V1))).equals(content)).toBe(true);
    });

    it('removes files that are not in the config and keeps specs/.gitkeep', async () => {
        await write(path.join(parent, 'service-repo', 'specs', ORDERS_V1), spec('1.0.0'));
        await write(path.join(root, 'specs', '.gitkeep'), '');
        await write(path.join(root, 'specs', 'retired-service-v1.yaml'), spec('1.0.0'));
        await write(path.join(root, 'specs', 'notes', 'old.txt'), 'old');
        await writeConfig([service([ORDERS_V1])]);

        const result = await run();

        expect(await readdir(path.join(root, 'specs'))).toEqual(['.gitkeep', ORDERS_V1]);
        expect(result.removed.sort()).toEqual(['notes', 'retired-service-v1.yaml']);
    });

    it('creates specs/ when it does not exist yet', async () => {
        await write(path.join(parent, 'service-repo', 'specs', ORDERS_V1), spec('1.0.0'));
        await writeConfig([service([ORDERS_V1])]);

        await run();

        expect(await readdir(path.join(root, 'specs'))).toEqual([ORDERS_V1]);
    });

    it('does not change anything when it runs a second time', async () => {
        await write(path.join(parent, 'service-repo', 'specs', ORDERS_V1), spec('1.0.0'));
        await writeConfig([service([ORDERS_V1])]);
        await run();

        const result = await run();

        expect(result.added).toEqual([]);
        expect(result.changed).toEqual([]);
        expect(result.removed).toEqual([]);
        expect(result.unchanged).toEqual([{ name: ORDERS_V1, version: '1.0.0' }]);
    });

    it('reports an added, a removed, a changed and an unchanged file', async () => {
        await write(path.join(parent, 'service-repo', 'specs', 'added-service-v1.yaml'), spec('0.2.0'));
        await write(path.join(parent, 'service-repo', 'specs', 'changed-service-v1.yaml'), spec('0.1.1'));
        await write(path.join(parent, 'service-repo', 'specs', 'same-service-v1.yaml'), spec('1.0.0'));
        await write(path.join(root, 'specs', 'changed-service-v1.yaml'), spec('0.1.0'));
        await write(path.join(root, 'specs', 'same-service-v1.yaml'), spec('1.0.0'));
        await write(path.join(root, 'specs', 'removed-service-v1.yaml'), spec('3.0.0'));
        await writeConfig([service(['added-service-v1.yaml', 'changed-service-v1.yaml', 'same-service-v1.yaml'])]);

        const result = await run();

        expect(result).toEqual({
            added: [{ name: 'added-service-v1.yaml', version: '0.2.0' }],
            changed: [{ name: 'changed-service-v1.yaml', version: '0.1.1', previousVersion: '0.1.0' }],
            unchanged: [{ name: 'same-service-v1.yaml', version: '1.0.0' }],
            removed: ['removed-service-v1.yaml']
        });
        expect(formatSummary(result).split('\n')).toEqual([
            'specs/ updated: 1 added, 1 changed, 1 removed, 1 unchanged.',
            '  added      added-service-v1.yaml (0.2.0)',
            '  changed    changed-service-v1.yaml (0.1.0 -> 0.1.1)',
            '  removed    removed-service-v1.yaml',
            '  unchanged  same-service-v1.yaml (1.0.0)'
        ]);
    });

    it('shows a changed file with the same version without an arrow', async () => {
        await write(path.join(parent, 'service-repo', 'specs', ORDERS_V1), spec('1.0.0') + '# edited\n');
        await write(path.join(root, 'specs', ORDERS_V1), spec('1.0.0'));
        await writeConfig([service([ORDERS_V1])]);

        expect(formatSummary(await run())).toContain('  changed    orders-service-v1.yaml (1.0.0)');
    });

    describe('when a check fails', () => {
        beforeEach(async () => {
            await write(path.join(parent, 'service-repo', 'specs', ORDERS_V1), spec('1.0.0'));
            await write(path.join(root, 'specs', '.gitkeep'), '');
            await write(path.join(root, 'specs', 'previous-service-v1.yaml'), spec('0.9.0'));
        });

        async function expectFailure(pattern: RegExp): Promise<void> {
            const before = await snapshot(path.join(root, 'specs'));

            await expect(run()).rejects.toThrow(CopySpecsError);
            await expect(run()).rejects.toThrow(pattern);

            expect(await snapshot(path.join(root, 'specs'))).toEqual(before);
            expect(await leftovers()).toEqual([]);
        }

        it('names a sibling repository folder that does not exist', async () => {
            await writeConfig([service([ORDERS_V1], 'missing-repo')]);
            await expectFailure(/\.\.\/missing-repo does not exist/);
        });

        it('names a spec folder that does not exist', async () => {
            await writeConfig([service([ORDERS_V1], 'service-repo', 'api')]);
            await expectFailure(/\.\.\/service-repo\/api does not exist/);
        });

        it('names a listed file that does not exist', async () => {
            await writeConfig([service([ORDERS_V1, 'missing-service-v1.yaml'])]);
            await expectFailure(/\.\.\/service-repo\/specs\/missing-service-v1\.yaml: the file does not exist/);
        });

        it.each([
            ['is not valid YAML', 'openapi: [3.0.3\n', /not valid YAML/],
            ['is not an OpenAPI document', 'title: just a document\n', /no "openapi" field/],
            ['is OpenAPI 3.1', spec('1.0.0', '3.1.0'), /OpenAPI 3\.1\.0, but only 3\.0\.x/],
            ['is Swagger 2.0', 'swagger: "2.0"\ninfo:\n  version: 1.0.0\n', /no "openapi" field/],
            ['has no info.version', 'openapi: 3.0.3\ninfo:\n  title: Test\n', /no "info\.version"/],
            ['has a numeric info.version', 'openapi: 3.0.3\ninfo:\n  version: 1.0\n', /no "info\.version"/]
        ])('names a file that %s', async (_label, content, pattern) => {
            await write(path.join(parent, 'service-repo', 'specs', 'bad-service-v1.yaml'), content);
            await writeConfig([service([ORDERS_V1, 'bad-service-v1.yaml'])]);
            await expectFailure(new RegExp(`bad-service-v1\\.yaml .*${pattern.source}`));
        });

        it.each(['orders.yaml', 'orders-service.yaml', 'Orders-service-v1.yaml', 'orders-service-v1.yml', 'orders-service-vx.yaml'])('rejects the file name %s', async (name) => {
            await write(path.join(parent, 'service-repo', 'specs', name), spec('1.0.0'));
            await writeConfig([service([ORDERS_V1, name])]);
            await expectFailure(new RegExp(`${name.replaceAll('.', '\\.')}: the name must look like <service>-service-v<N>\\.yaml`));
        });

        it('rejects a file listed twice in one entry', async () => {
            await writeConfig([service([ORDERS_V1, ORDERS_V1])]);
            await expectFailure(/orders-service-v1\.yaml is listed twice/);
        });

        it('rejects two entries that copy to the same file name', async () => {
            await write(path.join(parent, 'other-repo', 'specs', ORDERS_V1), spec('2.0.0'));
            await writeConfig([service([ORDERS_V1]), service([ORDERS_V1], 'other-repo')]);
            await expectFailure(/orders-service-v1\.yaml is listed twice \(first copied from \.\.\/service-repo\/specs\/orders-service-v1\.yaml\)/);
        });

        it('reports every problem in one message', async () => {
            await writeConfig([service([ORDERS_V1, 'missing-service-v1.yaml', 'bad.yaml'], 'service-repo'), service([SHIPPING_V1], 'missing-repo')]);

            const error = await run().catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(CopySpecsError);
            expect((error as CopySpecsError).problems).toHaveLength(3);
        });

        it('does not create specs/ when it did not exist', async () => {
            await rm(path.join(root, 'specs'), { recursive: true });
            await writeConfig([service([ORDERS_V1, 'missing-service-v1.yaml'])]);

            await expect(run()).rejects.toThrow(CopySpecsError);

            expect(await readdir(root)).not.toContain('specs');
        });
    });

    it('puts specs/ back as it was when the swap fails part way', async () => {
        await write(path.join(parent, 'service-repo', 'specs', ORDERS_V1), spec('1.0.0'));
        await write(path.join(parent, 'service-repo', 'specs', SHIPPING_V1), spec('1.0.0'));
        await write(path.join(root, 'specs', '.gitkeep'), '');
        await write(path.join(root, 'specs', 'previous-service-v1.yaml'), spec('0.9.0'));
        await write(path.join(root, 'specs', ORDERS_V1), spec('0.8.0'));
        await writeConfig([service([ORDERS_V1, SHIPPING_V1])]);
        const before = await snapshot(path.join(root, 'specs'));

        // Two old files move aside, the first new file moves in, and the second new file fails.
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
        let calls = 0;
        vi.mocked(rename).mockImplementation(async (from, to) => {
            calls += 1;
            if (calls === 4) {
                throw new Error('disk trouble');
            }
            return actual.rename(from, to);
        });

        try {
            await expect(run()).rejects.toThrow('disk trouble');
        } finally {
            vi.mocked(rename).mockImplementation(actual.rename);
        }

        expect(calls).toBeGreaterThan(4);
        expect(await snapshot(path.join(root, 'specs'))).toEqual(before);
        expect(await leftovers()).toEqual([]);
    });
});

describe('parseConfig', () => {
    it('reads a valid config', () => {
        expect(parseConfig('{"services":[{"repo":"storefront-backend","specsPath":"specs","files":["orders-service-v1.yaml"]}]}')).toEqual([{ repo: 'storefront-backend', specsPath: 'specs', files: ['orders-service-v1.yaml'] }]);
    });

    it.each([
        ['{not json', /specs\.config\.json is not valid JSON/],
        ['[]', /must be an object with a "services" array/],
        ['{"services":[]}', /"services" must be a non-empty array/],
        ['{"services":[{"repo":"a","specsPath":"specs","files":["a-service-v1.yaml"]}],"extra":1}', /unknown field "extra"/],
        ['{"services":["a"]}', /services\[0\] must be an object/],
        ['{"services":[{"specsPath":"specs","files":["a-service-v1.yaml"]}]}', /services\[0\]\.repo must be the name of a sibling folder/],
        ['{"services":[{"repo":"../a","specsPath":"specs","files":["a-service-v1.yaml"]}]}', /services\[0\]\.repo must be the name of a sibling folder/],
        ['{"services":[{"repo":"a","specsPath":"../specs","files":["a-service-v1.yaml"]}]}', /services\[0\]\.specsPath must be a relative folder/],
        ['{"services":[{"repo":"a","specsPath":"/specs","files":["a-service-v1.yaml"]}]}', /services\[0\]\.specsPath must be a relative folder/],
        ['{"services":[{"repo":"a","files":["a-service-v1.yaml"]}]}', /services\[0\]\.specsPath must be a relative folder/],
        ['{"services":[{"repo":"a","specsPath":"specs","files":[]}]}', /services\[0\]\.files must be a non-empty array/],
        ['{"services":[{"repo":"a","specsPath":"specs","files":["x/a-service-v1.yaml"]}]}', /services\[0\]\.files\[0\] must be a file name/],
        ['{"services":[{"repo":"a","specsPath":"specs","files":["a-service-v1.yaml"],"extra":1}]}', /services\[0\] has an unknown field "extra"/]
    ])('rejects %s and names the field', (text, pattern) => {
        expect(() => parseConfig(text)).toThrow(CopySpecsError);
        expect(() => parseConfig(text)).toThrow(pattern);
    });

    it('fails with a clear message when specs.config.json is missing', async () => {
        await expect(run()).rejects.toThrow(/specs\.config\.json was not found/);
    });
});
