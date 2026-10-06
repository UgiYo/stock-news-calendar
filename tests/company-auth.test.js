import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{hash} from '../worker/index.js';
import {signCompanyJWT} from '../worker/company-auth.js';
const encode=x=>Buffer.from(x).toString('base64url');
async function setup(){
 const db=new DatabaseSync(':memory:');for(const file of ['0001_init.sql','0002_company_auth.sql'])db.exec(readFileSync(new URL('../worker/migrations/'+file,import.meta.url),'utf8'));
 const adapter={prepare(q){return {bind(...args){return {async first(){return db.prepare(q).get(...args)||null},async run(){return db.prepare(q).run(...args)}}}}},async batch(list){db.exec('BEGIN');try{const result=await Promise.all(list.map(x=>x.run()));db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const privateKey=await crypto.subtle.exportKey('jwk',pair.privateKey),pub={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'fixture'};
 const env={DB:adapter,APP_URL:'https://example.com/',COMPANY_AUTH_ENABLED:'true',COMPANY_LOGIN_URL:'https://inside.example/login',COMPANY_ISSUER:'company',COMPANY_REQUEST_KID:'fixture',COMPANY_REQUEST_PRIVATE_JWK:JSON.stringify(privateKey),COMPANY_ASSERTION_JWKS:JSON.stringify({keys:[pub]})};
 const call=async(path,body)=>worker.fetch(new Request('https://worker.example/auth/company/'+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined}),env);
 const verifier=encode(crypto.getRandomValues(new Uint8Array(32))),state=encode(crypto.getRandomValues(new Uint8Array(32))),challenge=encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
 const start=await call('start',{state,challenge}),url=new URL((await start.json()).url),c=JSON.parse(Buffer.from(url.searchParams.get('request').split('.')[1],'base64url'));
 const claims={iss:'company',aud:'https://worker.example',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60,auth_time:Math.floor(Date.now()/1000),sub:'a'.repeat(32),name:'Employee',jti:encode(crypto.getRandomValues(new Uint8Array(32))),transaction:c.transaction};
 return {db,env,call,verifier,state,claims,privateKey};
}
test('company login exchanges only correct PKCE/state once and expires session in an hour',async()=>{
 const {db,call,verifier,state,claims,privateKey}=await setup();try{
 const assertion=await signCompanyJWT(claims,privateKey,'fixture');const reported=await call('assertions',{assertion});assert.equal(reported.status,200);const {code}=await reported.json();
 assert.equal((await call('assertions',{assertion})).status,409);
 assert.equal((await call('exchange',{code,verifier:'b'.repeat(43),state})).status,400);
 assert.equal((await call('exchange',{code,verifier,state:'b'.repeat(43)})).status,400);
 const responses=await Promise.all([call('exchange',{code,verifier,state}),call('exchange',{code,verifier,state})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);
 const token=(await responses.find(r=>r.status===200).json()).session;const session=db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(await hash(token));assert.match(session.user_id,/^company:/);assert.ok(session.expires_at-Date.now()<=3600000);assert.ok(session.expires_at>Date.now()+3500000);
 }finally{db.close();}
});
test('company assertion rejects forged signature, issuer, audience, expiry and missing auth_time',async()=>{
 const {db,call,claims,privateKey}=await setup();try{
 for(const change of [{iss:'evil'},{aud:'evil'},{exp:1},{auth_time:undefined},{sub:'username'},{iat:Math.floor(Date.now()/1000)+100}])assert.equal((await call('assertions',{assertion:await signCompanyJWT({...claims,...change},privateKey,'fixture')})).status,400);
 assert.equal((await call('assertions',{assertion:await signCompanyJWT(claims,privateKey,'unknown')})).status,400);
 const token=await signCompanyJWT(claims,privateKey,'fixture');assert.equal((await call('assertions',{assertion:token.slice(0,-5)+'AAAAA'})).status,400);
 assert.equal((await call('assertions',{assertion:token,password:'never-accepted'})).status,400);
 }finally{db.close();}
});
test('disabled company login is explicit and does not require new tables for existing deployments',async()=>{
 const env={APP_URL:'https://example.com/'};const r=await worker.fetch(new Request('https://worker.example/auth/company/config'),env);assert.deepEqual(await r.json(),{enabled:false});assert.equal((await worker.fetch(new Request('https://worker.example/auth/company/start',{method:'POST',body:'{}'}),env)).status,503);
});
test('expired company code rejects without creating a user',async()=>{const {db,call,claims,privateKey,verifier,state}=await setup();try{const {code}=await (await call('assertions',{assertion:await signCompanyJWT(claims,privateKey,'fixture')})).json();db.exec('UPDATE company_auth_transactions SET code_expires_at=1');assert.equal((await call('exchange',{code,verifier,state})).status,400);assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,0);}finally{db.close();}});
