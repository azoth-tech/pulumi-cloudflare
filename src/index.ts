import * as pulumi from '@pulumi/pulumi';
import * as cloudflare from '@pulumi/cloudflare';
import * as command from '@pulumi/command';
import * as fs from 'fs';
import * as path from 'path';
import {
    camelToSnake,
    CloudflareCredentials, CloudflareResources, createResourceInfo, extractBinding, getD1DbName, isSecret,
    ParsedResource, parseResource,
    PROP,
    pulumiProperty,
    snakeToCamel

} from "./common/index.js";
import * as HandleBars from "handlebars";
import {createD1Toml, createKVToml, createToml, createVarsToml} from "./common/templateutils.js";

const config = new pulumi.Config();
const stackName = pulumi.getStack();

const projectRoot = path.resolve(__dirname, '..');
const instanceDir = path.join(projectRoot, "instances", stackName);
const wranglerTomlFile = path.join(instanceDir, 'wrangler.toml');

const creds: CloudflareCredentials = {
    apiToken: config.requireSecret(snakeToCamel(PROP.CLOUDFLARE_API_TOKEN)).get(),
    accountId: config.require(snakeToCamel(PROP.CLOUDFLARE_ACCOUNT_ID))
}

const projectId = pulumiProperty(config, PROP.PROJECT_ID);
const cloudFlareResource = pulumiProperty(config, PROP.CLOUDFLARE_RESOURCE)!;
const resources = cloudFlareResource.split(',').map(r => r.trim());

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
        let opts = existing ? {import: existing.id} : undefined;
        if (resourceType.startsWith('kv_')) {
            const kvResource = new cloudflare.WorkersKvNamespace(resourceName, {
                accountId: creds.accountId,
                title: resourceName,
            }, opts);
            response.kv!.push(createResourceInfo(resourceType, kvResource, binding));
        } else if (resourceType.startsWith('d1_')) {
            const d1Resource = new cloudflare.D1Database(resourceName, {
                accountId: creds.accountId,
                name: resourceName
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
    } catch (e) {
        console.log(`⚠️ Error Searching for ${resourceName}`);
        return null;
    }
    console.log(`⚠️ No existing resource ${resourceName}`);
    return null;
}

function createFinalToml(cloudflareResouces: CloudflareResources, projectId: string, config: pulumi.Config, creds: CloudflareCredentials) {
    const accountId = creds.accountId;
    return pulumi.all([
        cloudflareResouces.kv,
        cloudflareResouces.d1,
        cloudflareResouces.r2,
        projectId
    ]).apply(([kvList, d1List, r2List, projectId]) => {
        const d1Value = createD1Toml(d1List);
        const kvValue = createKVToml(kvList);
        // const r2Value = createR2Toml(r2List); // Uncomment when implemented
        const r2Value = '';
        const varsValue = createVarsToml(config);
        return createToml(projectId, accountId, d1Value, kvValue, r2Value, varsValue);
    });
}

const cloudflareResources = await synchronizeResources(creds, resources, projectId);
const resourceObjects = [
    ...((cloudflareResources?.kv ?? [])),
    ...((cloudflareResources?.d1 ?? [])),
    ...((cloudflareResources?.r2 ?? [])),
].map(x => x.resource);
let finalToml = createFinalToml(cloudflareResources, projectId, config, creds);

const createWranglerToml = new command.local.Command(
    'write-wrangler-toml',
    {
        create: pulumi.interpolate`mkdir -p ${projectRoot}/${instanceDir} && cat > ${wranglerTomlFile}`,
        stdin: finalToml,
        dir: projectRoot,
    },
    {dependsOn: resourceObjects}
);

let d1DbName = getD1DbName(cloudFlareResource, projectId);

const applySchema = d1DbName ? new command.local.Command(
    'apply-d1-schema',
    {
        create: `wrangler d1 migrations apply ${d1DbName} --config ${wranglerTomlFile}`,
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

const projectType = config.require(PROP.PROJECT_TYPE);
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
