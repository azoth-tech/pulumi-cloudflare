import {argsOf, executeRaw, PULUMI_DIR, snakeToCamel} from "./common/utils.js";
import {CLIOptions, ExecuteOptions, PROP} from "./common/types.js";




const options = argsOf();
const execOptions: ExecuteOptions = {
    cwd: PULUMI_DIR,
    env: {
        ...process.env
    },
    shell: false,
    stdoutPipe: false
};

async function list(options: CLIOptions) {

    // pulumi stack ls --cwd /Users/dvpandian/WebstormProjects/pulumi
    await executeRaw('pulumi', ['stack', 'ls', '--cwd', PULUMI_DIR, ], execOptions);

}

list(options).catch((error: Error) => {
    console.error('❌ Setup failed:', error.message);
    console.error("🛑 Stack:", error.stack);
    process.exit(1);
});

