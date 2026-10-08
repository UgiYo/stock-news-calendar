import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildCloudflarePagesApi} from '../scripts/build_cloudflare_pages.mjs';

test('Cloudflare Pages Advanced Mode bundle includes admin login handler',async()=>{
 const outputDir=await mkdtemp(path.join(os.tmpdir(),'cloudflare-pages-api-'));
 try{
  const outputFile=await buildCloudflarePagesApi(outputDir);
  const bundle=await readFile(outputFile,'utf8');
  assert.match(bundle,/admin\/login/);
  assert.match(bundle,/ADMIN_USERNAME/);
  assert.match(bundle,/ADMIN_PASSWORD/);
 }finally{
  await rm(outputDir,{recursive:true,force:true});
 }
});
