import * as pulumi from '@pulumi/pulumi';
import * as cloudflare from '@pulumi/cloudflare';
import * as command from '@pulumi/command';
import * as path from 'path';
import {
    CloudflareResources,
    createResourceInfo,
    extractBinding,
    getD1DbName,
    ParsedResource,
    parseResource,
    PROJECT_DIR,
    PROP,
    PULUMI_DIR,
    pulumiProperty,
    snakeToCamel,
} from "./common/index.js";
import {createD1Toml, createKVToml, createToml, createVarsToml} from "./common/templateutils.js";
import {createWorkerBindings} from "./common/secret-binding.js";

const config = new pulumi.Config();
const stackName = pulumi.getStack();

const projectRoot = PROJECT_DIR;
const instanceDir = path.join(PULUMI_DIR, "instances", stackName);
const wranglerTomlFile = path.join(instanceDir, 'wrangler.toml');

console.log(`🗂 Pulumi Config instanceDir: ${instanceDir}`)

const projectId = pulumiProperty(config, PROP.PROJECT_ID);
const projectType = pulumiProperty(config, PROP.PROJECT_TYPE);
const cloudFlareResource = pulumiProperty(config, PROP.CLOUDFLARE_RESOURCE)!;
const apiToken = config.requireSecret(snakeToCamel(PROP.CLOUDFLARE_API_TOKEN));
const accountId = config.require(snakeToCamel(PROP.CLOUDFLARE_ACCOUNT_ID));

const resources = cloudFlareResource.split(',').map(r => r.trim());


async function createCloudFlareResources(accountId: string, resources: string[], projectId: string): Promise<CloudflareResources> {
    let response: CloudflareResources = {
        kv: [], d1: [], r2: []
    };
    for (const resourceType of resources) {
        let inputResource: ParsedResource = parseResource(resourceType);
        const resourceName = inputResource.name ?? `${resourceType}_${projectId}`;

        console.log(`📦 Configuring Resources ${resourceName}`)
        const binding = extractBinding(resourceType);
        // const existing = await getExistingResource(accountId, resourceType, resourceName);
        if (resourceType.startsWith('kv_')) {
            // if (loadExistingResource(resourceType, resourceName, binding, existing, response.kv)) continue;
            const kvResource = new cloudflare.WorkersKvNamespace(resourceName, {
                accountId: accountId,
                title: resourceName,
            });
            response.kv!.push(createResourceInfo(resourceType, kvResource, binding));
        } else if (resourceType.startsWith('d1_')) {
            // if (loadExistingResource(resourceType, resourceName, binding, existing, response.d1)) continue;
            const d1Resource = new cloudflare.D1Database(resourceName, {
                accountId: accountId,
                name: resourceName,
                readReplication: {mode: 'disabled'}
            });
            response.d1!.push(createResourceInfo(resourceType, d1Resource, binding));
        } else if (resourceType.startsWith('r2_')) {
            // if (loadExistingResource(resourceType, resourceName, binding, existing, response.r2)) continue;
            const r2Resource = new cloudflare.R2Bucket(resourceName, {
                accountId: accountId,
                name: resourceName
            });
            response.r2!.push(createResourceInfo(resourceType, r2Resource, binding));
        }
    }
    return response;
}

function createFinalToml(cloudflareResouces: CloudflareResources, projectId: string, accountId: string) {
    const d1Value = createD1Toml(cloudflareResouces.d1);
    const kvValue = createKVToml(cloudflareResouces.kv);
    const r2Value = '';
    let allConfig = pulumi.runtime.allConfig()
    const varsValue = createVarsToml(allConfig);

    return pulumi.all([d1Value, kvValue]).apply(([resolvedD1, resolvedKv]) => {
        return createToml(projectId, accountId, resolvedD1, resolvedKv, r2Value, varsValue);
    });
}

const cloudflareResources = await createCloudFlareResources(accountId, resources, projectId);
const resourceObjects = [
    ...((cloudflareResources?.kv ?? [])),
    ...((cloudflareResources?.d1 ?? [])),
    ...((cloudflareResources?.r2 ?? []))]
    .filter(x => !x.existing)
    .map(x => x.resource);

console.log(`📦 Cloudflare Resource To be Created : ${resourceObjects.length} 📦`)
const finalToml = createFinalToml(cloudflareResources, projectId, accountId);

const createWranglerToml = new command.local.Command(
    "write-wrangler-toml",
    {
        create: pulumi.interpolate`npx tsx "./pulumi-cloudflare/scripts/create-wrangler-toml.ts" "${wranglerTomlFile}"`,
        stdin: finalToml,
        dir: projectRoot,
    },
    {dependsOn: resourceObjects}
);

let d1DbName = getD1DbName(cloudFlareResource, projectId);

const applySchema = d1DbName ? new command.local.Command(
    'apply-d1-schema',
    {
        create: `wrangler d1 migrations apply ${d1DbName} --remote --config ${wranglerTomlFile}`,
        dir: projectRoot,
        environment: {
            CLOUDFLARE_API_TOKEN: apiToken,
            CLOUDFLARE_ACCOUNT_ID: accountId,
            WRANGLER_SEND_METRICS: 'false',
        },
        triggers: [new Date().toISOString()],
    },
    {dependsOn: [createWranglerToml]}
) : undefined;

let deployment = [];
if (projectType == 'worker') {

    const bindings = createWorkerBindings(config);
    console.log("Binding:"+bindings)
    const worker = new cloudflare.WorkersScript(projectId, {
        accountId: accountId,
        content: `
                    addEventListener("fetch", event => {
                        event.respondWith(new Response("Hello world Script"))
                    });
                `,
        scriptName: projectId,
        bindings: bindings

    });


    const deployWorker = new command.local.Command(
        'deploy-worker',
        {
            create: `wrangler deploy --config ${wranglerTomlFile}`,
            dir: projectRoot,
            environment: {
                CLOUDFLARE_API_TOKEN: apiToken,
                CLOUDFLARE_ACCOUNT_ID: accountId,
                WRANGLER_SEND_METRICS: 'false',
            },
            triggers: [new Date().toISOString()],
        },
        {dependsOn: [worker, createWranglerToml]}
    );
    deployment.push(deployWorker);
}
