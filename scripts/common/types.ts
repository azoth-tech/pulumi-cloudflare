/**
 * Shared Type Definitions for Infrastructure Scripts
 */
import * as cloudflare from '@pulumi/cloudflare';

export interface CloudflareCredentials {
    apiToken: string;
    accountId: string;
}

export interface ParsedResource {
    prefix: string;
    name: string;
}

export interface TypedResource<T> {
    type: string;
    resource: T;
    binding?: string;
    existing:boolean;
}

export interface CloudflareResources {
    kv: TypedResource<cloudflare.WorkersKvNamespace>[]; // **not optional**
    d1: TypedResource<cloudflare.D1Database>[];
    r2: TypedResource<cloudflare.R2Bucket>[];
}

export interface ExecuteOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    shell?: boolean;
    input?: string;
    stdoutPipe?: boolean
}

export const PROP = {
    CLOUDFLARE_ACCOUNT_ID: 'CLOUDFLARE_ACCOUNT_ID',
    CLOUDFLARE_API_TOKEN: 'CLOUDFLARE_API_TOKEN',
    CLOUDFLARE_RESOURCE: 'CLOUDFLARE_RESOURCE',
    BASE_URL: 'BASE_URL',
    PROJECT_ID: 'PROJECT_ID',
    PROJECT_TYPE: 'PROJECT_TYPE',
    ENVIRONMENT:'ENVIRONMENT'
} as const;

export interface CLIOptions {
    stackName?: string;
    propertiesFile?: string;
    auto: boolean;
}