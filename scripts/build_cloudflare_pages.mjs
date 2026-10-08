import {mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function buildCloudflarePagesApi(outputDir=resolve(repoRoot,'cloudflare-api')){
 await mkdir(outputDir,{recursive:true});
 const outputFile=resolve(outputDir,'_worker.js');
 await build({entryPoints:[resolve(repoRoot,'worker/index.js')],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:outputFile});
 return outputFile;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const outputFile=await buildCloudflarePagesApi();
 process.stdout.write(`Cloudflare Pages Worker built: ${outputFile}\n`);
}
