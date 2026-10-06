// Company credentials never reach this Worker. Trust only the configured bridge key.
const enc=new TextEncoder();
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const bytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const alg={name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'};
export async function signCompanyJWT(claims,jwk,kid){const input=b64(enc.encode(JSON.stringify({alg:'RS256',typ:'JWT',kid})))+'.'+b64(enc.encode(JSON.stringify(claims)));const key=await crypto.subtle.importKey('jwk',jwk,alg,false,['sign']);return input+'.'+b64(await crypto.subtle.sign(alg,key,enc.encode(input)));}
export async function verifyCompanyJWT(token,jwks,issuer,audience){
 if(typeof token!=='string'||token.length>8192)throw Error('Invalid assertion');
 const parts=token.split('.');if(parts.length!==3)throw Error('Invalid assertion');
 const header=JSON.parse(new TextDecoder().decode(bytes(parts[0])));const jwk=jwks.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA'&&!k.d);
 if(header.alg!=='RS256'||header.typ!=='JWT'||!jwk)throw Error('Invalid signing key');
 const key=await crypto.subtle.importKey('jwk',jwk,alg,false,['verify']);if(!await crypto.subtle.verify(alg,key,bytes(parts[2]),enc.encode(parts[0]+'.'+parts[1])))throw Error('Invalid signature');
 const c=JSON.parse(new TextDecoder().decode(bytes(parts[1]))),now=Math.floor(Date.now()/1000);
 if(c.iss!==issuer||c.aud!==audience||!Number.isSafeInteger(c.iat)||!Number.isSafeInteger(c.exp)||c.iat>now+5||c.exp<=now||c.exp-c.iat>60||c.exp<=c.iat)throw Error('Invalid assertion claims');
 return c;
}
function configured(env){try{const u=new URL(env.COMPANY_LOGIN_URL);return env.COMPANY_AUTH_ENABLED==='true'&&u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&!!env.COMPANY_REQUEST_PRIVATE_JWK&&!!env.COMPANY_ASSERTION_JWKS&&!!env.COMPANY_ISSUER&&!!env.COMPANY_REQUEST_KID;}catch{return false;}}
const changes=r=>r?.meta?.changes??r?.changes??0;
export async function companyAuthRoute(req,env,{sql,reply,hash,randomToken,appURL}){
 const url=new URL(req.url),path=url.pathname;if(!path.startsWith('/auth/company/'))return null;
 if(path==='/auth/company/config'&&req.method==='GET')return reply({enabled:configured(env)});
 if(!configured(env))return reply({error:'公司登入尚未完成部署設定'},503);
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 if(Number(req.headers.get('Content-Length')||0)>12000)return reply({error:'Request too large'},413);
 let b;try{const text=await req.text();if(text.length>12000)throw Error();b=JSON.parse(text);}catch{return reply({error:'Invalid request'},400);}
 const now=Date.now(),seconds=Math.floor(now/1000),aud=url.origin;
 if(path==='/auth/company/start'){
  if(Object.keys(b).some(k=>!['state','challenge'].includes(k))||!/^[-_A-Za-z0-9]{43}$/.test(b.state||'')||!/^[-_A-Za-z0-9]{43}$/.test(b.challenge||''))return reply({error:'Invalid login request'},400);
  // Per-IP rolling fixed-window cap; counters contain no user credentials.
  const ip=await hash(req.headers.get('CF-Connecting-IP')||'unknown'),bucket=Math.floor(now/60000);
  const quota=await sql('INSERT INTO company_auth_limits VALUES(?,?,1) ON CONFLICT(ip_hash,bucket) DO UPDATE SET count=count+1 RETURNING count',ip,bucket).first();
  if(quota.count>20)return reply({error:'登入請求過於頻繁，請稍後重試'},429);
  await sql('DELETE FROM company_auth_limits WHERE bucket<?',bucket-10).run();await sql('DELETE FROM company_auth_transactions WHERE expires_at<?',now).run();
  const id=randomToken();await sql('INSERT INTO company_auth_transactions(id,state,challenge,expires_at) VALUES(?,?,?,?)',id,b.state,b.challenge,now+300000).run();
  const request=await signCompanyJWT({iss:aud,aud:env.COMPANY_ISSUER,iat:seconds,exp:seconds+60,transaction:id,state:b.state,redirect_uri:appURL.href},JSON.parse(env.COMPANY_REQUEST_PRIVATE_JWK),env.COMPANY_REQUEST_KID);
  const target=new URL(env.COMPANY_LOGIN_URL);target.searchParams.set('request',request);return reply({url:target.href});
 }
 if(path==='/auth/company/assertions'){
  let c;try{if(Object.keys(b).some(k=>k!=='assertion'))throw Error();c=await verifyCompanyJWT(b.assertion,JSON.parse(env.COMPANY_ASSERTION_JWKS),env.COMPANY_ISSUER,aud);
   if(!/^[0-9a-f]{32}$/.test(c.sub||'')||!/^[-_A-Za-z0-9]{20,100}$/.test(c.transaction||'')||!/^[-_A-Za-z0-9]{20,100}$/.test(c.jti||'')||!Number.isSafeInteger(c.auth_time)||c.auth_time>seconds+5||c.auth_time<seconds-60)throw Error();
  }catch{return reply({error:'Invalid company assertion'},400);}
  const code=randomToken(),id='company:'+await hash(c.iss+'\n'+c.sub);
  const result=await sql("UPDATE company_auth_transactions SET status='verified',subject=?,label=?,jti=?,code_hash=?,code_expires_at=? WHERE id=? AND status='pending' AND expires_at>?",id,String(c.name||'公司帳號').slice(0,100),c.jti,await hash(code),now+60000,c.transaction,now).run();
  if(!changes(result))return reply({error:'登入交易已過期或已使用'},409);return reply({code});
 }
 if(path==='/auth/company/exchange'){
  if(Object.keys(b).some(k=>!['code','verifier','state'].includes(k))||!/^[0-9a-f]{64}$/.test(b.code||'')||!/^[-_A-Za-z0-9]{43}$/.test(b.verifier||'')||!/^[-_A-Za-z0-9]{43}$/.test(b.state||''))return reply({error:'Invalid exchange'},400);
  const challenge=b64(await crypto.subtle.digest('SHA-256',enc.encode(b.verifier)));
  const row=await sql("UPDATE company_auth_transactions SET status='used' WHERE code_hash=? AND challenge=? AND state=? AND status='verified' AND code_expires_at>? AND expires_at>? RETURNING subject,label",await hash(b.code),challenge,b.state,now,now).first();
  if(!row)return reply({error:'公司登入已過期或無效，請重新登入'},400);
  const token=randomToken();await env.DB.batch([sql('INSERT INTO users VALUES(?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email',row.subject,row.label),sql('INSERT INTO sessions VALUES(?,?,?)',await hash(token),row.subject,now+3600000)]);
  return reply({session:token});
 }
 return reply({error:'Not found'},404);
}
