import {
    argsOf,
    CLIOptions, errorLog, executeJson, executeRaw,
    extractStackName,
    getCloudflareEnv,
    getProcessEnv, isSecret,
    PROP, prompt,
    propertyReader, pulumiConfig, pulumiUp, snakeToCamel
} from "./common/index.js";
import * as fs from "fs";

async function setup(options: CLIOptions): Promise<void> {
    console.log('\n🚀 Infrastructure Setup');
    console.log('=================================\n');
    const execOptions: { env?: NodeJS.ProcessEnv; cwd?: string; shell?: boolean; input?: string } = {};

    let setupProperties = await validateProperties(options.propertiesFile!,options.auto);
    console.log(`📄 Loading properties from: ${setupProperties}`);
    let reader = propertyReader(setupProperties);
    execOptions.env = getProcessEnv(reader);

    let stackName = extractStackName(reader.getRaw(PROP.BASE_URL)!);
    let stackList: any = await executeJson('npx pulumi stack ls --json');
    const stackExists: boolean = stackList.some((s: any) => s.name === stackName);

    const stackCmd = stackExists ? `pulumi stack select ${stackName}` : `pulumi stack init ${stackName}`;
    await executeRaw(stackCmd, [], execOptions);

    reader.each(async (key) => {
        const rawValue = reader.getRaw(key)!;
        await pulumiConfig(snakeToCamel(key), rawValue, isSecret(key));
    });
    await pulumiUp(options.auto);
}

async function validateProperties(propertiesFile: string, auto: boolean): Promise<string> {
    if (fs.existsSync(propertiesFile)) {
        return propertiesFile;
    }
    if (auto) {
        errorLog(`Properties file not found: ${propertiesFile}`);
    }
    let validPath = propertiesFile;
    while (!fs.existsSync(validPath)) {
        validPath = await prompt({
            message: 'Properties file not found. Enter path:',
            placeholder: './setup.properties',
            defaultValue: './setup.properties'
        });
    }

    return validPath;
}
const options = argsOf();
setup(options).catch((error: Error) => {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
});
