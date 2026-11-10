// Starts the spec-driven mock of every service. Run it with `npm run mock`. See mock/README.md.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_BASE_PORT, DEFAULT_STAGE, MockError, startMocks, type RunningMock } from './server.ts';

const USAGE = `Usage: npm run mock -- [--port <first port>] [--stage <name>] [--specs <folder>] [--quiet]

  --port     the port of the first service; the others follow in service order (default ${DEFAULT_BASE_PORT}). 0 picks free ports.
  --stage    the stage that GET /v0/version reports (default ${DEFAULT_STAGE}).
  --specs    the folder with the specs (default specs).
  --quiet    do not print a line for every request.`;

export interface CliOptions {
    root: string;
    argv: string[];
    log?: (text: string) => void;
    error?: (text: string) => void;
    /** Called once the mocks are running, with a function that stops them. The default waits for Ctrl+C. */
    onStarted?: (mocks: RunningMock[], stop: () => Promise<void>) => Promise<void>;
}

export function formatStarted(mocks: RunningMock[], specsDir: string): string {
    const width = Math.max(...mocks.map((mock) => mock.service.length));
    const lines = mocks.map((mock) => `  ${mock.service.padEnd(width)}  ${mock.url}   ${mock.specs.map((spec) => `${spec.prefix} ${spec.version}`).join(', ')}`);
    return [`Mocks of the specs in ${specsDir} (example responses, no state):`, ...lines].join('\n');
}

/** What `npm run mock` does, and returns the exit code (0 stopped, 1 could not start, 2 wrong usage). */
export async function runCli(options: CliOptions): Promise<number> {
    const log = options.log ?? ((text: string) => console.log(text));
    const error = options.error ?? ((text: string) => console.error(text));

    let basePort: number | undefined;
    let stage: string | undefined;
    let specs: string | undefined;
    let quiet: boolean;
    try {
        const parsed = parseArgs({ args: options.argv, allowPositionals: false, options: { port: { type: 'string' }, stage: { type: 'string' }, specs: { type: 'string' }, quiet: { type: 'boolean' } } });
        if (parsed.values.port !== undefined) {
            basePort = Number(parsed.values.port);
            if (!Number.isInteger(basePort) || basePort < 0 || basePort > 65_000) {
                throw new Error(`"${parsed.values.port}" is not a port`);
            }
        }
        stage = parsed.values.stage;
        specs = parsed.values.specs;
        quiet = parsed.values.quiet === true;
    } catch (cause) {
        error(`${cause instanceof Error ? cause.message : String(cause)}\n${USAGE}`);
        return 2;
    }

    const specsDir = path.resolve(options.root, specs ?? 'specs');
    let mocks: RunningMock[];
    try {
        mocks = await startMocks({ specsDir, basePort, stage, log: quiet ? undefined : log });
    } catch (cause) {
        if (cause instanceof MockError) {
            error(`mock failed: ${cause.message}`);
            return 1;
        }
        throw cause;
    }

    log(formatStarted(mocks, specsDir));
    for (const warning of mocks.flatMap((mock) => mock.warnings)) {
        error(`warning: ${warning}`);
    }
    const stop = (): Promise<void> => Promise.all(mocks.map((mock) => mock.close())).then(() => undefined);
    if (options.onStarted !== undefined) {
        await options.onStarted(mocks, stop);
        return 0;
    }
    log('Press Ctrl+C to stop.');
    await new Promise<void>((resolvePromise) => {
        process.once('SIGINT', () => resolvePromise());
        process.once('SIGTERM', () => resolvePromise());
    });
    await stop();
    return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await runCli({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), argv: process.argv.slice(2) });
}
