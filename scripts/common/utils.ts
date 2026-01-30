/**
 * Shared Utility Functions for Infrastructure Scripts
 */

import * as fs from 'fs';
import {CLIOptions, ParsedResource, PROP} from './types.js';
// @ts-ignore
import PropertiesReader from 'properties-reader';
import {parseArgs} from 'util';
import {execa} from 'execa';
import {isCancel, text, TextOptions} from "@clack/prompts";
import {Config, Output} from '@pulumi/pulumi';
import * as path from 'path';
import {dirname, resolve} from 'path';
import {fileURLToPath} from "url";

export const MAX_RETRY_ATTEMPTS = 6;
export const RETRY_DELAY_SECONDS = 10;
export const COMMAND_TIMEOUT_MS = 30000; // 30 seconds
export const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const PULUMI_DIR = path.join(PROJECT_DIR, "pulumi");

console.log(`🗂 projectRoot:${PROJECT_DIR} \n🗂 pulumiDir: ${PULUMI_DIR}`)


export async function executeRaw(
    command: string, args: string[] = [],
    options: {
        cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean; input?: string;
    } = {}
): Promise<string | undefined> {
    console.log(`  🏄‍♂️ ${command} ${args.join(' ')}`);
    const env = {...process.env, ...options.env};
    try {
        const {stdout} = await execa(command, args, {
            cwd: options.cwd,
            env: env,
            timeout: 60000,
            killSignal: 'SIGTERM',
            shell: options.shell,
            input: options.input,
            stdio: options.input ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe']
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
    return JSON.parse(output || '{}');
}

export async function pulumiConfig(key: string, value: string, isSecret = false): Promise<void> {
    const options = {
        env: {...process.env},
        input: value,
        shell: true
    }
    const secretFlag = isSecret ? '--secret' : '';
    await executeRaw('pulumi', ['config', 'set', key, secretFlag, '--cwd', PULUMI_DIR], options);
}

export async function pulumiUp(auto: boolean = false, options:any):
    Promise<void> {
    await executeRaw(`npx pulumi`, ['up', '--yes', '--cwd', PULUMI_DIR,'--verbose=0'], options);
}

export function isSecret(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return ['key', 'secret', 'token', 'password'].some(keyword =>
        lowerKey.includes(keyword)
    );
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
        throw new Error(`Invalid BASE_URL format: ${baseUrl}`);
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

export async function validatePassPhrase(propertiesFile: string, auto: boolean, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
    if (env.PULUMI_CONFIG_PASSPHRASE || env.PULUMI_CONFIG_PASSPHRASE_FILE) {
        return env.PULUMI_CONFIG_PASSPHRASE;
    }

    if (auto) {
        errorLog('PULUMI_CONFIG_PASSPHRASE environment variable is not set');
    }

    const passphrase = await prompt({
        message: 'Enter PULUMI_CONFIG_PASSPHRASE:',
        placeholder: 'Enter your Pulumi stack passphrase'
    });
    return passphrase;
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

    const mainPart = input.split(':')[0];
    const underscoreIndex = mainPart.indexOf('_');

    return underscoreIndex > -1 && underscoreIndex < mainPart.length - 1
        ? mainPart.slice(underscoreIndex + 1).toUpperCase()
        : '';
}
export function getD1DbName(cloudflareResource: string, projectId: string): string | undefined {
    const d1SpecList = cloudflareResource
        .split(',')
        .map(s => s.trim())
        .filter(s => s.startsWith('d1_'));

    if (d1SpecList.length == 0) return undefined;
    const d1Spec = d1SpecList[0];

    if (d1Spec.includes(':')) {
        return d1Spec.split(':')[1]?.trim() || undefined;
    }
    return `${d1Spec}_${projectId}`;
}
