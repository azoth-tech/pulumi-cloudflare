import {
    argsOf,
    CLIOptions,
    errorLog,
    ExecuteOptions,
    executeRaw,
    isStackValid,
    PROP,
    PULUMI_DIR,
    snakeToCamel
} from "./common/index.js";
import path from "path";


async function cleanup(options: CLIOptions): Promise<void> {
    console.log('=================================');
    console.log('🎬 Infrastructure Cleanup');
    console.log('=================================\n');

    const execOptions: ExecuteOptions = {
        cwd: PULUMI_DIR,
        env: {
            ...process.env
        },
        shell: false,
        stdoutPipe: false
    };
    if (!options.stackName) {
        errorLog("StackName is Mandatory")
    }
    const stackName = normalizeStackName(options.stackName!)
    await validateStack(stackName, execOptions);
    await executeRaw('pulumi', ['stack', 'select', stackName, '--cwd', PULUMI_DIR], execOptions);

    const optsWithPipe: ExecuteOptions = {...execOptions, stdoutPipe: true};

    const apiToken = await executeRaw('pulumi', ['config', 'get', '--stack', stackName, snakeToCamel(PROP.CLOUDFLARE_API_TOKEN), '--cwd', PULUMI_DIR], optsWithPipe);
    const accountId = await executeRaw('pulumi', ['config', 'get', '--stack', stackName, snakeToCamel(PROP.CLOUDFLARE_ACCOUNT_ID), '--cwd', PULUMI_DIR], optsWithPipe);
    const projectId = await executeRaw('pulumi', ['config', 'get', '--stack', stackName, snakeToCamel(PROP.PROJECT_ID), '--cwd', PULUMI_DIR], optsWithPipe);

    if (!apiToken || !accountId) {
        errorLog(`Cloudflare Credentials are not available `)
    }
    // pulumi destroy -s <stack>
    const optsWithEnv: ExecuteOptions = {
        ...execOptions,
        env: {
            ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId,
            CLOUDFLARE_API_TOKEN: apiToken,
        },
        input: 'Y',
        stdoutPipe: true
    };
    const wranglerTomlFile = path.join(PULUMI_DIR, "instances", stackName, 'wrangler.toml');
    console.log(`Started Clean Up using accountId ${accountId}, projectId ${projectId}, Stack:${stackName} `)
    // wrangler delete --config ${wranglerTomlFile}
    await executeRaw('wrangler', ['delete', projectId!, '--config', wranglerTomlFile], optsWithEnv);
    optsWithEnv.stdoutPipe=false;
    await executeRaw('pulumi', ['destroy', '--stack', stackName, '--remove', '--cwd', PULUMI_DIR, '--yes', '--skip-preview'], optsWithEnv);
    // pulumi stack rm -s <stack>


}

async function validateStack(stackName: string, execOptions: ExecuteOptions): Promise<void> {
    const stackExists = await isStackValid(stackName, execOptions);
    if (!stackExists) {
        await executeRaw('pulumi', ['stack', 'ls', '--cwd', PULUMI_DIR], execOptions);
        errorLog(`Invalid StackName:${options.stackName}`)
    }
}

export function normalizeStackName(input: string): string {
    let value = input.trim();
    if (value.includes('://')) {
        value = new URL(value).hostname;
    }
    value = value.split('/')[0];
    return value.replace(/\./g, '-');
}

const options = argsOf();
cleanup(options).catch((error: Error) => {
    console.error('❌ Setup failed:', error.message);
    console.error("🛑 Stack:", error.stack);
    process.exit(1);
});

