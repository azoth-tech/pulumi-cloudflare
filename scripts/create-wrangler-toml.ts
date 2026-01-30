import * as fs from 'fs';
import * as path from 'path';

const targetFile = process.argv[2];
if (!targetFile) {
    console.error('Usage: tsx write-file.ts <target-path>');
    process.exit(1);
}

const content = fs.readFileSync(0, 'utf-8');
fs.mkdirSync(path.dirname(targetFile), { recursive: true });
fs.writeFileSync(targetFile, content);
console.log(`Created: ${targetFile}`);