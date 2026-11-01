// Generates a client with every candidate from the same spec, then measures it.
// Usage: npm run spike            (all candidates)
//        npm run spike -- orval   (only the named candidates)
// OpenAPI Generator needs Java 11+ on the PATH (or JAVA_HOME set). The others only need Node.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SPEC = '../../tests/fixtures/specs/generator-spike.yaml';
const OGEN_PROPS = 'useSingleRequestParameter=true,supportsES6=true,importFileExtension=.js';

interface Candidate {
    id: string;
    needsJava: boolean;
    /** Arguments for `npx`, writing the generated client into `out` (hey-api and orval take the path from their config files). */
    generate: (out: string) => string[];
}

const candidates: Candidate[] = [
    { id: 'ogen-fetch', needsJava: true, generate: (out) => ['openapi-generator-cli', 'generate', '-i', SPEC, '-g', 'typescript-fetch', '-o', out, `--additional-properties=${OGEN_PROPS}`] },
    { id: 'ogen-axios', needsJava: true, generate: (out) => ['openapi-generator-cli', 'generate', '-i', SPEC, '-g', 'typescript-axios', '-o', out, `--additional-properties=${OGEN_PROPS}`] },
    { id: 'heyapi', needsJava: false, generate: () => ['openapi-ts', '-f', 'openapi-ts.config.mjs'] },
    { id: 'orval', needsJava: false, generate: () => ['orval', '--config', 'orval.config.mjs'] },
    { id: 'openapi-fetch', needsJava: false, generate: (out) => ['openapi-typescript', SPEC, '-o', `${out}/schema.ts`] } // types only; the runtime is the openapi-fetch package
];

const run = (args: string[]) => spawnSync(['npx', ...args.map((arg) => `"${arg}"`)].join(' '), { shell: true, encoding: 'utf8' });

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));

const hashTree = (dir: string): Map<string, string> => new Map(walk(dir).map((file) => [relative(dir, file), createHash('sha256').update(readFileSync(file)).digest('hex')]));

const hasJava = spawnSync('java -version', { shell: true }).status === 0;
const wanted = process.argv.slice(2);
const selected = candidates.filter((c) => wanted.length === 0 || wanted.includes(c.id));

rmSync('out', { recursive: true, force: true });
mkdirSync('out', { recursive: true });
writeFileSync('out/tsconfig.base.json', JSON.stringify({ extends: '../tsconfig.json' }));

interface Row {
    id: string;
    generated: boolean;
    seconds?: number;
    deterministic?: boolean;
    tsFiles?: number;
    tsLines?: number;
    tsKiB?: number;
    typecheck?: Record<string, { errors: number; sample: string[] }>;
    facadeTypeErrors?: number;
    probesPassed?: number;
    probesFailed?: string[];
    note?: string;
}

const rows: Row[] = [];

for (const candidate of selected) {
    const row: Row = { id: candidate.id, generated: false };
    rows.push(row);
    if (candidate.needsJava && !hasJava) {
        row.note = 'skipped: java not found (install Java 11+ or set JAVA_HOME)';
        continue;
    }

    // Generate, then generate again over the same folder and compare, to check the output is deterministic.
    const out = `out/${candidate.id}`;
    const started = Date.now();
    const first = run(candidate.generate(out));
    row.seconds = (Date.now() - started) / 1000;
    if (first.status !== 0) {
        row.note = `generate failed: ${(first.stderr || first.stdout).trim().split('\n').slice(-3).join(' | ')}`;
        continue;
    }
    row.generated = true;
    const before = hashTree(out);
    rmSync(out, { recursive: true, force: true });
    const second = run(candidate.generate(out));
    const after = second.status === 0 ? hashTree(out) : new Map<string, string>();
    row.deterministic = before.size === after.size && [...before].every(([file, hash]) => after.get(file) === hash);

    // Size of the generated TypeScript only (docs, ignore files and metadata are not counted).
    const sources = walk(out).filter((file) => file.endsWith('.ts'));
    row.tsFiles = sources.length;
    row.tsLines = sources.reduce(
        (sum, file) =>
            sum +
            readFileSync(file, 'utf8')
                .split('\n')
                .filter((line) => line.trim() !== '').length,
        0
    );
    row.tsKiB = Math.round(sources.reduce((sum, file) => sum + statSync(file).size, 0) / 102.4) / 10;

    // Typecheck the generated code and its probe under the library's settings (strict, NodeNext), once with the
    // library's current `lib` (ES2023, no DOM types) and once with DOM types added.
    row.typecheck = {};
    for (const [name, lib] of [
        ['lib ES2023', ['ES2023']],
        ['lib ES2023+DOM', ['ES2023', 'DOM']]
    ] as const) {
        const tsconfig = `out/tsconfig.${candidate.id}.json`;
        writeFileSync(tsconfig, JSON.stringify({ extends: './tsconfig.base.json', compilerOptions: { lib }, include: [`../${out}`, `../probes/${candidate.id}.test.ts`] }));
        const tsc = run(['tsc', '-p', tsconfig]);
        const errors = (tsc.stdout + tsc.stderr).split('\n').filter((line) => line.includes('error TS'));
        row.typecheck[name] = { errors: errors.length, sample: errors.slice(0, 4).map((line) => line.trim()) };
    }

    // Decision record 0004: check that mapped types can turn the generated classes into the facade's call shape.
    if (candidate.id === 'heyapi') {
        writeFileSync('out/tsconfig.facade.json', JSON.stringify({ extends: './tsconfig.base.json', compilerOptions: { lib: ['ES2023', 'DOM'] }, include: [`../${out}`, '../probes/facade-types.ts'] }));
        const tsc = run(['tsc', '-p', 'out/tsconfig.facade.json']);
        row.facadeTypeErrors = (tsc.stdout + tsc.stderr).split('\n').filter((line) => line.includes('error TS')).length;
    }

    // Run the shared scenario against the mock server.
    const report = `out/probe-${candidate.id}.json`;
    run(['vitest', 'run', `probes/${candidate.id}.test.ts`, '--reporter=json', `--outputFile=${report}`]);
    if (existsSync(report)) {
        const result = JSON.parse(readFileSync(report, 'utf8')) as { numPassedTests: number; testResults: { assertionResults: { status: string; title: string }[] }[] };
        row.probesPassed = result.numPassedTests;
        row.probesFailed = result.testResults.flatMap((file) => file.assertionResults.filter((a) => a.status === 'failed').map((a) => a.title));
    }
}

writeFileSync('out/summary.json', JSON.stringify(rows, null, 2));
for (const row of rows) {
    console.log(`\n${row.id}`);
    for (const [key, value] of Object.entries(row)) {
        if (key !== 'id') console.log(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value, null, 2).replaceAll('\n', '\n  ') : value}`);
    }
}
