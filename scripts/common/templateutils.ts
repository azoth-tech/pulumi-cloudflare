import {TypedResource} from "./types.js";
import {getConfigKey, IGNORE_PROP_LIST, isSecret} from "./utils.js";
import * as cloudflare from '@pulumi/cloudflare';
import * as pulumi from '@pulumi/pulumi';
import Handlebars from 'handlebars';

const tomlTemplate = `
name = "{{projectId}}"
main = "../../../src/index.ts"
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
migrations_dir = "../../../migrations"
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


export function createD1Toml(d1List: TypedResource<cloudflare.D1Database>[]): pulumi.Output<string> {
    return pulumi.all(d1List.map(d => pulumi.all([d.binding, d.resource.name, d.resource.id]))).apply(resolvedItems => {
        const items = resolvedItems.map(([binding, name, id]) => ({
            binding,
            name,
            id,
        }));
        const template = Handlebars.compile(d1TemplateStr, {noEscape: true});
        return template({items});
    });
}

export function createKVToml(kvList: TypedResource<cloudflare.WorkersKvNamespace>[]): pulumi.Output<string> {
    return pulumi.all(kvList.map(d => pulumi.all([d.binding, d.resource.title, d.resource.id]))).apply(resolvedItems => {
        const items = resolvedItems.map(([binding, title, id]) => ({
            binding,
            name: title,
            id,
        }));
        const template = Handlebars.compile(kvTemplateStr, {noEscape: true});
        return template({items});
    });
}

export function createVarsToml(config: Record<string, unknown>): string {

    const vars = Object.entries(config)
        .map(([key, value]) => {
            const configKey = getConfigKey(key);
            if (IGNORE_PROP_LIST.has(configKey.snakeKey) || isSecret(configKey.snakeKey)) {
                return null;
            }
            const tomlValue = formatTomlValue(value);
            return tomlValue ? `${configKey.snakeKey} = ${tomlValue}` : null;
        })
        .filter((line): line is string => line !== null);

    return `[vars]\n${vars.join("\n")}\n`;
}

function formatTomlValue(value: unknown): string | undefined {
    if (value == null) return undefined;

    switch (typeof value) {
        case 'boolean':
        case 'number':
            return value.toString();
        case 'string':
            return `"${value.replace(/"/g, '\\"')}"`;
        default:
            return undefined;
    }
}
export function createToml(projId: string, accountId: string, d1Value: string, kvValue: string, r2Value: string, varsValue: string): string {
    const template = Handlebars.compile(tomlTemplate, {noEscape: true});
    return template({
        projectId: projId,
        accountId,
        d1Value,
        kvValue,
        r2Value,
        varsValue
    });
}
