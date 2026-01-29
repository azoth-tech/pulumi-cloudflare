/**
 * Shared Utility Functions for Infrastructure Scripts
 */

import * as fs from 'fs';
import {execSync} from 'child_process';
import {CLIOptions, CloudflareResources, ParsedResource, PROP, PulumiStack} from './types.js';
// @ts-ignore
import PropertiesReader from 'properties-reader';
import {parseArgs} from 'util';
import {execa} from 'execa';
import {text, TextOptions, isCancel} from "@clack/prompts";
import * as pulumi from '@pulumi/pulumi';
import {Config} from "@pulumi/pulumi";


export const MAX_RETRY_ATTEMPTS = 6;
export const RETRY_DELAY_SECONDS = 10;
export const COMMAND_TIMEOUT_MS = 30000; // 30 seconds


export async function executeRaw(
    command: string, args: string[] = [],
    options: {
        cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean; input?: string;
    } = {}
): Promise<string | undefined> {
    console.log(`  → ${command} ${args.join(' ')}`);

    try {
        const {stdout} = await execa(command, args, {
            cwd: options.cwd,
            env: options.env,
            timeout: 60000,
            killSignal: 'SIGTERM',
            shell: options.shell,
            input: options.input,
            stdio: options.input ? ['pipe', 'pipe', 'pipe'] : 'inherit'
        });
        return stdout;

    } catch (error: any) {
        if (error.stdout) console.log(error.stdout);
        if (error.stderr) console.error(error.stderr);

        throw new Error(`Command failed: ${command} - ${error.message}`);
    }
}

export async function executeJson(
    command: string, args: string[] = [],
    options: {
        cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean; input?: string;
    } = {}
): Promise<any> {
    let output = await executeRaw(command, args, options);
    return JSON.parse(output || '[]');
}

export async function pulumiConfig(key: string, value: string, isSecret = false): Promise<void> {
    const options = {
        env: {...process.env},
        input: value
    }
    await executeRaw('npx', ['pulumi', 'config', 'set', key, '--secret'], options);
}

export async function pulumiUp(auto = false): Promise<void> {
    const options = {
        env: {...process.env}
    }
    const upCmd = auto ? 'npx pulumi up --yes' : 'npx pulumi up';
    await executeRaw(upCmd, [], options);
}


export function isSecret(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return ['key', 'secret', 'token', 'password'].some(keyword =>
        lowerKey.includes(keyword)
    );

}

export function getAvailableStacks(): string[] {
    try {
        const result = execSync('pulumi stack ls --json', {
            encoding: 'utf8',
            timeout: COMMAND_TIMEOUT_MS,
        });
        const stacks: PulumiStack[] = JSON.parse(result);
        return stacks
            .map((stack: PulumiStack) => stack.name)
            .filter((name: string) => name.includes('.workers.dev'));
    } catch (error) {
        console.error('❌ Failed to list available stacks:', error instanceof Error ? error.message : String(error));
        return [];
    }
}

export function propertyReader(filePath: string): PropertiesReader.Reader {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Properties file not found: ${filePath}`);
    }
    return PropertiesReader(filePath);
}

export function getProperty(filePath: string, key: string): string {
    return propertyReader(filePath).getRaw(key) ?? '';
}


export function argsOf(): CLIOptions {
    const {values, positionals} = parseArgs({
        args: process.argv.slice(2),
        options: {
            stack: {type: 'string', short: 's'},
            properties: {type: 'string', short: 'p'},
            auto: {type: 'boolean', short: 'y'},
        },
        allowPositionals: true
    });

    return {
        stackName: values.stack || positionals[0],
        propertiesFile: values.properties,
        auto: values.auto || false
    };
}


export function getStackName(filePath: string): string {
    let baseurl = getProperty(filePath, PROP.BASE_URL);
    return extractStackName(baseurl);
}

export function extractStackName(baseUrl: string): string {
    try {
        const url = new URL(baseUrl);
        return url.hostname.replace(/\./g, '-');
    } catch {
        throw new Error(`Invalid WORKER_BASE_URL format: ${baseUrl}`);
    }
}

export function snakeToCamel(str: string): string {
    return str.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// camelCase → UPPER_SNAKE_CASE
export function camelToSnake(str: string): string {
    return str
        .replace(/([A-Z])/g, '_$1')
        .toUpperCase()
        .replace(/^_/, ''); // Remove leading underscore if present
}

export function errorLog(str: string): string {
    console.error(`❌ ${str}`);
    process.exit(1);
}

export async function validatePassPhrase(propertiesFile: string, auto: boolean, env: NodeJS.ProcessEnv = process.env): Promise<void> {
    if (!env.PULUMI_CONFIG_PASSPHRASE) {
        if (auto) {
            errorLog('PULUMI_CONFIG_PASSPHRASE environment variable is not set')
            process.exit(1);
        } else {

        }
    }
}

export async function prompt(options: TextOptions): Promise<string> {
    const userResponse = await text(options);
    if (isCancel(userResponse)) {
        process.exit(0);
    }
    return userResponse;
}


export function pulumiProperty(config: Config, key: string): string {
    const pulumiKey = snakeToCamel(key);
    const response = config.get(pulumiKey);
    if (response === undefined) {
        errorLog(`Key ${key}, pulumiKey ${pulumiKey} is not configured`);
    }
    return <string>response;
}

export function parseResource(spec: string): ParsedResource {
    const [prefix, name] = spec.split(":").map(s => s.trim());
    return {prefix: prefix, name: name};
}

export const createResourceInfo =
    (resourceType: string, resource: any, binding: string) =>
        ({type: resourceType, resource, binding});

export function extractBinding(input: string): string {
    if (!input) return '';
    const dashIndex = input.lastIndexOf('-');
    if (dashIndex === -1 || dashIndex === input.length - 1) {
        return '';
    }
    return input.substring(dashIndex + 1);
}
export function getD1DbName(cloudflareResource: string, projectId: string): string | undefined {
    const d1SpecList = cloudflareResource
        .split(',')
        .map(s => s.trim())
        .filter(s => s.startsWith('d1_'));

    if (d1SpecList.length == 0) return undefined;
    const d1Spec=d1SpecList[0];

    if (d1Spec.includes(':')) {
        return d1Spec.split(':')[1]?.trim() || undefined;
    }
    return `${d1Spec}_${projectId}`;
}
