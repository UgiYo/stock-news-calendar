import test from 'node:test';
import assert from 'node:assert/strict';
import {publicHost,publicIPv4,extractive} from '../supabase/functions/summarize/logic.ts';
test('reject internal URL hosts and network ranges',()=>{for(const h of ['localhost','192.168.1.1','foo.local','[::1]'])assert.equal(publicHost(h),false);assert.equal(publicHost('www.cna.com.tw'),true);for(const ip of ['127.0.0.1','10.1.2.3','172.16.1.1','192.168.1.1','169.254.169.254','100.64.0.1','224.0.0.1'])assert.equal(publicIPv4(ip),false);assert.equal(publicIPv4('8.8.8.8'),true);});
test('extraction covers beginning middle and end without fabricated text',()=>{const text=Array.from({length:12},(_,i)=>`新聞第${i}段，公司今日公布這是一段足夠長的實際新聞內容。`).join('');const summary=extractive(text);assert.match(summary,/新聞第0段/);assert.match(summary,/新聞第8段/);assert.match(summary,/新聞第11段/);assert.equal(extractive(''), '');});
import {rpcPublisher,googleRequest} from '../supabase/functions/summarize/logic.ts';
test('Google News RPC parses framed payload and preserves escaped URLs',()=>{
 const inner=JSON.stringify(['garturlres','https://example.com/story?x=1&y=2']);
 const body=")]}'\n\n120\n"+JSON.stringify([['wrb.fr','Fbv4je',inner,null]]);
 assert.equal(rpcPublisher(body),'https://example.com/story?x=1&y=2');
 assert.throws(()=>rpcPublisher(JSON.stringify([['wrb.fr','Fbv4je',JSON.stringify(['garturlres','javascript:bad'])]])));
 assert.throws(()=>rpcPublisher('unexpected response'));
});
test('Google request serializes parameters as JSON data',()=>{
 const signature='signature"\\with escapes';
 const outer=JSON.parse(googleRequest('CBMi123',1700000000,signature));
 const payload=JSON.parse(outer[0][0][1]);
 assert.equal(payload[0],'garturlreq');assert.equal(payload[2],'CBMi123');assert.equal(payload[4],signature);
});
