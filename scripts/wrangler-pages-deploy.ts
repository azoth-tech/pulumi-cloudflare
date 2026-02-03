import * as path from 'path';
import {executeRaw, PROJECT_DIR} from "./common/utils.js";
import {rmSync} from "node:fs";
import {ExecuteOptions} from "@common/types.js";

const deployProjectId = process.argv[2];
const deployEnv = process.argv[3];
if (!deployProjectId || !deployEnv) {
    console.error('Usage: tsx wrangler-pages-deploy.ts <deploy-project-id> <deploy-env>');
    process.exit(1);
}

function clean(projectRoot: string) {
    rmSync(path.join(projectRoot, "node_modules", ".cache", "wrangler"), {
        recursive: true,
        force: true,
    });
    rmSync(path.join(projectRoot, ".wrangler"), {
        recursive: true,
        force: true,
    });
}


const execOptions: ExecuteOptions = {
    cwd: PROJECT_DIR,
    env: {
        ...process.env
    },
    shell: false,
    stdoutPipe: false
};
clean(PROJECT_DIR);
await executeRaw('npm', ['run', 'build']);
await executeRaw('wrangler', ['pages', 'deploy', 'dist', '--project-name',deployProjectId,'--branch' ,'production', '--commit-dirty=true'], execOptions);