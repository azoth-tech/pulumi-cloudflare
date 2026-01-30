import * as pulumi from '@pulumi/pulumi';
import * as cloudflare from '@pulumi/cloudflare';
import * as command from '@pulumi/command';
import * as path from 'path';
import {
    CloudflareCredentials,
    CloudflareResources,
    createResourceInfo,
    extractBinding,
    getD1DbName,
    ParsedResource,
    parseResource,
    PROP,PROJECT_DIR,
    pulumiProperty,
    snakeToCamel
} from "./common/index.js";
import {createD1Toml, createKVToml, createToml, createVarsToml} from "./common/templateutils.js";

const config = new pulumi.Config();
const stackName = pulumi.getStack();

const projectRoot = PROJECT_DIR;
const instanceDir = path.join(projectRoot, "instances", stackName);
const wranglerTomlFile = path.join(instanceDir, 'wrangler.toml');

console.log(`🗂 Pulumi Config instanceDir: ${instanceDir}`)

const projectId = pulumiProperty(config, PROP.PROJECT_ID);
const projectType = pulumiProperty(config,PROP.PROJECT_TYPE);
const cloudFlareResource = pulumiProperty(config, PROP.CLOUDFLARE_RESOURCE)!;

const resources = cloudFlareResource.split(',').map(r => r.trim());
const creds: CloudflareCredentials = {
    apiToken: (snakeToCamel(PROP.CLOUDFLARE_API_TOKEN)),
    accountId: config.require(snakeToCamel(PROP.CLOUDFLARE_ACCOUNT_ID))
}

async function synchronizeResources(creds: CloudflareCredentials, resources: string[], projectId: string): Promise<CloudflareResources> {
    let response: CloudflareResources = {
        kv: [], d1: [], r2: []
    };
    for (const resourceType of resources) {
        let inputResource: ParsedResource = parseResource(resourceType);
        const resourceName = inputResource.name ?? `${resourceType}_${projectId}`;

        console.log(`📦 Configuring Resources ${resourceName}`)

        const binding = extractBinding(resourceType);
        const existing = await getExistingResource(creds, resourceType, resourceName);
        let opts = existing ? {import: `${creds.accountId}/${existing.id}`} : undefined;
        if (resourceType.startsWith('kv_')) {
            const kvResource = new cloudflare.WorkersKvNamespace(resourceName, {
                accountId: creds.accountId,
                title: resourceName,
            }, opts);
            response.kv!.push(createResourceInfo(resourceType, kvResource, binding));
        } else if (resourceType.startsWith('d1_')) {
            const d1Resource = new cloudflare.D1Database(resourceName, {
                accountId: creds.accountId,
                name: resourceName,
                readReplication: { mode: 'disabled' }
            }, opts);
            response.d1!.push(createResourceInfo(resourceType, d1Resource, binding));
        } else if (resourceType.startsWith('r2_')) {
            const r2Resource = new cloudflare.R2Bucket(resourceName, {
                accountId: creds.accountId,
                name: resourceName
            }, opts);
            response.r2!.push(createResourceInfo(resourceType, r2Resource, binding));
        }
    }
    return response;
}

async function getExistingResource(creds: CloudflareCredentials, resourceType: string, resourceName: string):
    Promise<{ id: string, name?: string } | null> {
    try {
        if (resourceType.startsWith('kv_')) {
            const namespaces = await cloudflare.getWorkersKvNamespaces({
                accountId: creds.accountId
            });
            const found = namespaces.results?.find(ns => ns.title === resourceName);
            return found ? {id: found.id, name: found.title} : null;
        } else if (resourceType.startsWith('d1_')) {
            const databases = await cloudflare.getD1Databases({
                accountId: creds.accountId,
                name: resourceName
            });
            const found = databases.results?.find(db => db.name === resourceName);
            return found ? {id: found.id, name: found.name} : null;
        } else if (resourceType.startsWith('r2_')) {
            // Use plural to list all, then filter by name
            const bucket = await cloudflare.getR2Bucket({
                accountId: creds.accountId,
                bucketName: resourceName
            });
            return bucket ? {id: bucket.id} : null;
        }
    } catch (e: any) {
        console.log(`⚠️ Error Searching for ${resourceName} ,${e.message}`);
        console.error(e.trace)
        return null;
    }
    console.log(`⚠️ No existing resource ${resourceName}`);
    return null;
}

function createFinalToml(cloudflareResouces: CloudflareResources, projectId: string, creds: CloudflareCredentials) {
    const accountId = creds.accountId;
    const d1Value = createD1Toml(cloudflareResouces.d1);
    const kvValue = createKVToml(cloudflareResouces.kv);
    const r2Value = '';
    let allConfig= pulumi.runtime.allConfig()

    const varsValue = createVarsToml(allConfig);
    return pulumi.all([d1Value, kvValue]).apply(([resolvedD1, resolvedKv]) => {
        return createToml(projectId, accountId, resolvedD1, resolvedKv, r2Value, varsValue);
    });
}

const cloudflareResources = await synchronizeResources(creds, resources, projectId);
const resourceObjects = [
    ...((cloudflareResources?.kv ?? [])),
    ...((cloudflareResources?.d1 ?? [])),
    ...((cloudflareResources?.r2 ?? [])),
].map(x => x.resource);
let finalToml = createFinalToml(cloudflareResources, projectId, creds);


const createWranglerToml = new command.local.Command(
    "write-wrangler-toml",
    {
        create: pulumi.interpolate`npx tsx "./pulumi-cloudflare/scripts/create-wrangler-toml.ts" "${wranglerTomlFile}"`,
        stdin: finalToml,
        dir: projectRoot,
    },
    { dependsOn: resourceObjects }
);

let d1DbName = getD1DbName(cloudFlareResource, projectId);

const applySchema = d1DbName ? new command.local.Command(
    'apply-d1-schema',
    {
        create: `wrangler d1 migrations apply ${d1DbName} --remote --config ${wranglerTomlFile}`,
        dir: projectRoot,
        environment: {
            CLOUDFLARE_API_TOKEN: creds.apiToken,
            CLOUDFLARE_ACCOUNT_ID: creds.accountId,
            WRANGLER_SEND_METRICS: 'false',
        },
        triggers: [new Date().toISOString()],
    },
    {dependsOn: [createWranglerToml]}
) : undefined;

if (projectType == 'worker') {
    const deployWorker = new command.local.Command(
        'deploy-worker',
        {
            create: `wrangler deploy --config ${wranglerTomlFile}`,
            delete: `wrangler delete --config ${wranglerTomlFile} || true`,
            dir: projectRoot,
            environment: {
                CLOUDFLARE_API_TOKEN: creds.apiToken,
                CLOUDFLARE_ACCOUNT_ID: creds.accountId,
                WRANGLER_SEND_METRICS: 'false',
            },
            triggers: [new Date().toISOString()],
        },
        {dependsOn: [createWranglerToml]}
    );
}
