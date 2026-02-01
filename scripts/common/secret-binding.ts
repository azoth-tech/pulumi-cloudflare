import * as pulumi from "@pulumi/pulumi";
import {getConfigKey, IGNORE_PROP_LIST, isSecret} from "./utils.js";
import {WorkerScriptBinding} from "@pulumi/cloudflare/types/input.js";



export function createWorkerBindings(config: pulumi.Config): WorkerScriptBinding[] {
    const allConfig = pulumi.runtime.allConfig();
    const bindings: WorkerScriptBinding[] = [];
    for (const fullKey in allConfig) {
        const configKey = getConfigKey(fullKey);
        if (IGNORE_PROP_LIST.has(configKey.snakeKey)) continue;

        const value = config.get(configKey.camelKey);
        const secretValue = config.getSecret(configKey.camelKey);
        const hasSecret=isSecret(configKey.camelKey);
        if (value && !hasSecret) {
            bindings.push({
                name: configKey.snakeKey,
                type: "plain_text" as const,   // <- add as const here
                text: value,
            });
        } else if (secretValue || (value && hasSecret)) {
            bindings.push({
                name: configKey.snakeKey,
                type: "secret_text" as const, // <- add as const here
                text: secretValue ?? pulumi.secret(value!),
            });
        }
    }

    return bindings;
}
