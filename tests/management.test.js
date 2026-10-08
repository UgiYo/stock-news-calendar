import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {managementRoute} from '../worker/management.js';
async function setup(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../worker/migrations/0001_init.sql',import.meta.url),'utf8'));
 db.prepare('INSERT INTO users VALUES(?,?)').run('google-user','user@example.com');
 const sql=(q,...args)=>({first:async()=>db.prepare(q).get(...args)||null,all:async()=>({results:db.prepare(q).all(...args)}),run:async()=>db.prepare(q).run(...args)});
 const reply=(data,status=200)=>Response.json(data,{status});
 const env={ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'test-password'};
 const route=(req)=>managementRoute(req,env,{sql,reply,randomToken:()=>crypto.randomUUID()});
 return {db,sql,route};
}
const request=(path,{method='GET',token,body}={})=>new Request('https://worker.example'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
test('independent admin login controls global and per-user feature flags',async()=>{
 const {db,sql,route}=await setup();
 assert.equal((await route(request('/admin/login',{method:'POST',body:{username:'admin',password:'wrong'}}))).status,401);
 const login=await route(request('/admin/login',{method:'POST',body:{username:'admin',password:'test-password'}}));
 assert.equal(login.status,200);const {token}=await login.json();
 assert.equal((await route(request('/management',{token:'invalid'}))).status,401);
 const initial=await (await route(request('/management',{token}))).json();assert.equal(initial.users[0].email,'user@example.com');
 assert.equal((await route(request('/management/features',{method:'PUT',token,body:{features:[{key:'ai_tools.assistant',enabled:false}]}}))).status,200);
 const defaultUser=await (await route(request('/features',{token:'google-token'}))).json().catch(()=>null);
 assert.equal(defaultUser,null);
 const userFlags=await (await route(request('/features'))).json();assert.equal(userFlags.error,'請先登入');
 const override=await route(request('/management/users/google-user/features',{method:'PUT',token,body:{key:'ai_tools.assistant',enabled:true}}));assert.equal(override.status,200);
 const data=await (await route(request('/management',{token}))).json();assert.equal(data.features['ai_tools.assistant'],false);assert.equal(data.overrides[0].enabled,true);
 assert.equal((await route(request('/admin/logout',{method:'POST',token}))).status,200);
 assert.equal((await route(request('/management',{token}))).status,401);
 db.close();
});
test('blacklisting a user revokes their existing sessions',async()=>{
 const {db,sql,route}=await setup();await sql('INSERT INTO sessions VALUES(?,?,?)','user-session','google-user',Date.now()+60000);
 const {token}=await (await route(request('/admin/login',{method:'POST',body:{username:'admin',password:'test-password'}}))).json();
 assert.equal((await route(request('/management/users/google-user/blacklist',{method:'PUT',token,body:{blacklisted:true}}))).status,200);
 assert.equal(await sql('SELECT token_hash FROM sessions WHERE user_id=?','google-user').then(x=>x.first()),null);
 db.close();
});
test('admin login is disabled until deployment credentials are configured',async()=>{
 const {route}=await setup();
 const response=await route(request('/admin/login',{method:'POST',body:{username:'',password:''}}));assert.equal(response.status,401);
});
