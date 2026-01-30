/**
 * Shared Type Definitions for Infrastructure Scripts
 */
import * as pulumi from '@pulumi/pulumi';
import * as cloudflare from '@pulumi/cloudflare';

export interface CloudflareCredentials {
    apiToken: string;
    accountId: string;
}

export interface ParsedResource {
    prefix: string;
    name: string;
};

export interface TypedResource<T> {
    type: string;
    resource: T;
    binding?: string;
}
export interface CloudflareResources {
    kv: TypedResource<cloudflare.WorkersKvNamespace>[]; // **not optional**
    d1: TypedResource<cloudflare.D1Database>[];
    r2: TypedResource<cloudflare.R2Bucket>[];
}


export const PROP = {
    CLOUDFLARE_ACCOUNT_ID: 'CLOUDFLARE_ACCOUNT_ID',
    CLOUDFLARE_API_TOKEN: 'CLOUDFLARE_API_TOKEN',
    CLOUDFLARE_RESOURCE: 'CLOUDFLARE_RESOURCE',
    BASE_URL: 'BASE_URL',
    PROJECT_ID: 'PROJECT_ID',
    PROJECT_TYPE: 'PROJECT_TYPE'
} as const;

export interface ResourceInfo {
    type: string;
    binding: string;
    id: pulumi.Output<string>;
    name: string;
    resource: pulumi.Resource;
    isExisting: boolean;
}

export interface CLIOptions {
    stackName?: string;
    propertiesFile?: string;
    auto: boolean;
}

export interface KVNamespace {
    id: string;
    title: string;
}

export interface D1Database {
    uuid: string;
    name: string;
}

export interface PulumiStack {
    name: string;
    current?: boolean;
}

export interface ExistingResources {
    kvId?: string;
    d1Id?: string;
}

export interface ConfigMapping {
    [key: string]: string;
}

