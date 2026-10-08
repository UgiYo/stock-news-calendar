import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../functions/[[path]].js';

test('Cloudflare Pages routes admin login to the shared Worker handler',async()=>{
 const request=new Request('https://news-calendar-api.pages.dev/admin/login',{method:'POST',headers:{Origin:'https://ugiyo.github.io','Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'secret'})});
 const response=await onRequest({request,env:{APP_URL:'https://ugiyo.github.io/stock-news-calendar/'}});
 const body=await response.json();
 assert.equal(response.status,503);
 assert.match(body.error,/ADMIN_USERNAME.*ADMIN_PASSWORD/);
 assert.notEqual(body.error,'Forbidden');
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://ugiyo.github.io');
});
