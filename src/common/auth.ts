/**
 * Authentication and Configuration Utilities
 */

import {execSync} from 'child_process';

import {CloudflareCredentials, PROP} from './types.js';
import {executeRaw, propertyReader} from './utils.js';
import {Reader} from "properties-reader";
import {apiKey, apiToken} from "@pulumi/cloudflare/config/index.js";

export function getCloudflareEnv(creds: CloudflareCredentials): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {...process.env};
    if (!creds.apiToken || !creds.accountId) {
        throw new Error('Cloudflare API Credentials is not available');
    }

    env.CLOUDFLARE_API_TOKEN = creds.apiToken;
    env.CLOUDFLARE_ACCOUNT_ID = creds.accountId;
    env.WRANGLER_SEND_METRICS = 'false';

    delete env.CLOUDFLARE_EMAIL;
    delete env.CLOUDFLARE_API_KEY;
    delete env.CF_API_TOKEN;
    delete env.CF_ACCOUNT_ID;
    delete env.CF_API_KEY;
    delete env.WRANGLER_API_TOKEN;
    delete env.WRANGLER_ACCOUNT_ID;

    return env;
}


export function getProcessEnv(reader: Reader): NodeJS.ProcessEnv {
    let creds: CloudflareCredentials = {
        apiToken: reader.getRaw(PROP.CLOUDFLARE_API_TOKEN)?.trim()!,
        accountId: reader.getRaw(PROP.CLOUDFLARE_ACCOUNT_ID)?.trim()!
    }
    return getCloudflareEnv(creds);
}

export async function isPulumiLoggedIn(): Promise<boolean> {
    try {
        await executeRaw('pulumi', ['whoami']);
        return true;
    } catch {
        return false;
    }
}


/**
 * Ensure Pulumi is logged in, exit if not
 */
export function ensurePulumiLogin(): void {
    if (!isPulumiLoggedIn()) {
        console.error('❌ Not logged in to Pulumi. Run: pulumi login');
        process.exit(1);
    }
}
