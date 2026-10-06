// Run locally; output directory contains private keys and MUST NOT be committed.
import {mkdirSync,writeFileSync} from 'node:fs';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
const dir=process.argv[2];if(!dir)throw Error('Usage: node generate-keys.mjs /private/secrets');mkdirSync(dir,{recursive:true,mode:0o700});
for(const [name,kid] of [['worker-request','worker-v1'],['company-signing','company-v1']]){
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const pub={...publicKey.export({format:'jwk'}),kid,alg:'RS256',use:'sig'};
 writeFileSync(dir+'/'+name+'-public.jwks.json',JSON.stringify({keys:[pub]}),{mode:0o600,flag:'wx'});
 writeFileSync(dir+'/'+name+'-private.jwk.json',JSON.stringify({...privateKey.export({format:'jwk'}),kid}),{mode:0o600,flag:'wx'});
 writeFileSync(dir+'/'+name+'-private.pem',privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600,flag:'wx'});
}
writeFileSync(dir+'/flask-secret.txt',randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
