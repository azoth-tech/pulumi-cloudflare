import {ParsedResource, PROP, TypedResource} from "./types.js";
import {camelToSnake, isSecret} from "./utils.js";
import * as cloudflare from '@pulumi/cloudflare';
import * as pulumi from '@pulumi/pulumi';

const tomlTemplate = `
name = "{{projectId}}"
main = "../../src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]
account_id = "{{accountId}}"

[observability]
enabled = true
head_sampling_rate = 1
{{d1Value}}

{{kvValue}}

{{r2Value}}

{{varsValue}}
 `.trim();

const d1TemplateStr = `
{{#if items}}
[[d1_databases]]
{{#each items}}
    binding = "{{binding}}"
    database_name = "{{name}}"
    database_id = "{{id}}"
{{/each}}
{{else}}
# No databases configured
{{/if}}
`.trim();

const kvTemplateStr = `
{{#if items}}
[[kv_namespaces]]
{{#each items}}
    binding = "{{binding}}"
    id = "{{id}}"
{{/each}}
{{else}}
# No KV namespaces configured
{{/if}}
`.trim();


export function createD1Toml(d1List: TypedResource<cloudflare.D1Database>[]): string {
    const items = d1List.map(d => ({
        binding: d.binding,
        name: d.resource.name,
        id: d.resource.id,
    }));
    const template = Handlebars.compile(d1TemplateStr);
    return template({items});
}

export function createKVToml(kvList: TypedResource<cloudflare.WorkersKvNamespace>[]): string {
    const items = kvList.map(d => ({
        binding: d.binding,
        name: d.resource.title,
        id: d.resource.id,
    }));
    const template = Handlebars.compile(kvTemplateStr);
    return template({items});
}

export function createVarsToml(config: pulumi.Config): string {
    const ignoreList: string[] = [PROP.CLOUDFLARE_RESOURCE, PROP.CLOUDFLARE_API_TOKEN, PROP.CLOUDFLARE_ACCOUNT_ID, PROP.PROJECT_ID];
    let varStr = "[vars]\n";
    for (const [key, value] of Object.entries(config)) {
        // Pulumi config keys come as "project:key"
        const cleanKey = key.includes(":") ? key.split(":")[1] : key;
        let snakeKey = camelToSnake(cleanKey);
        if (ignoreList.includes(snakeKey) || isSecret(snakeKey)) {
            continue;
        }
        varStr += `${snakeKey} = "${value}"\n`;
    }
    return varStr;
}

export function createToml(projId: string, accountId: string, d1Value: string, kvValue: string, r2Value: string, varsValue: string): string {
    const template = Handlebars.compile(tomlTemplate);
    return template({
        projectId: projId,
        accountId,
        d1Value,
        kvValue,
        r2Value,
        varsValue
    });
}
