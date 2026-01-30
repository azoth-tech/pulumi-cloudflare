import {Reader} from "properties-reader";
import {
    argsOf,
    CLIOptions,
    errorLog,
    executeJson,
    executeRaw,
    extractStackName,
    getProcessEnv,
    isSecret,
    prompt,
    PROP,
    PROJECT_DIR,
    PULUMI_DIR,
    propertyReader,
    pulumiConfig,
    pulumiUp,
    validatePassPhrase,
    snakeToCamel
} from "./common/index.js";
import * as fs from "fs";

async function setup(options: CLIOptions): Promise<void> {
    console.log('=================================');
    console.log('🎬 Infrastructure Setup');
    console.log('=================================\n');
    const execOptions: { env?: NodeJS.ProcessEnv; cwd?: string; shell?: boolean; input?: string } =
        {
            shell: true,
            cwd: PULUMI_DIR
        };
    let setupProperties = await validateProperties(options.propertiesFile!, options.auto);
    console.log(`🗓 Loading properties from: ${setupProperties}`);
    let reader = propertyReader(setupProperties);

    const requiredKeys: string[] = Object.values(PROP);
    await validateKeys(reader,requiredKeys);
    execOptions.env = getProcessEnv(reader);
    const passphrase = await validatePassPhrase(setupProperties, options.auto, execOptions.env);
    if (passphrase) {
        execOptions.env.PULUMI_CONFIG_PASSPHRASE = passphrase;
    }
    let stackName = extractStackName(reader.getRaw(PROP.BASE_URL)!);
    console.log(`🗓 Using Stack :${stackName}`)

    let stackList: any = await executeJson('pulumi', ['stack', 'ls', '--cwd', PULUMI_DIR, '--json'], execOptions);
    const stackExists: boolean = stackList.some((s: any) => s.name === stackName);

    console.log(`\n🗓 ${stackName} exists ${stackExists}`)

    const cmdList = stackExists ? ['stack', 'select'] : ['stack', 'init'];
    cmdList.push(stackName, '--cwd', PULUMI_DIR);
    await executeRaw('pulumi', cmdList, execOptions);

    await setupPulumiConfig(reader);
    console.log(`\n✅ Completed Pulumi Config Creation\n`);

    await pulumiUp(options.auto,execOptions);
}

async function setupPulumiConfig(reader: Reader) {
    const keys = Object.keys(reader.getAllProperties());
    for (const key of keys) {
        const rawValue = reader.getRaw(key)!;
        await pulumiConfig(snakeToCamel(key), rawValue, isSecret(key));
    }
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
async function validateKeys(reader:Reader, keys:string[]): Promise<void> {
    for (let key of keys) {
        let value = reader.getRaw(key);
        if(value == null){
            errorLog(`Missing Key ${key}`);
        }
    }
}
const options = argsOf();
setup(options).catch((error: Error) => {
    console.error('❌ Setup failed:', error.message);
    console.error("🛑 Stack:", error.stack);
    process.exit(1);
});
