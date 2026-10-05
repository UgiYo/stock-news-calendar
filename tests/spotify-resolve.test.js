import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSpotifyPodcast} from '../worker/podcasts.js';
test('Spotify lookup keeps matching shows and authors, removes unsafe feeds and duplicates',async()=>{
 const calls=[];const fetcher=async(url,options)=>{assert.equal(options.redirect,'manual');calls.push(url);return calls.length===1?new Response('<meta property="og:title" content="測試節目"/>'):Response.json({results:[{collectionName:'測試節目',artistName:'作者甲',feedUrl:'https://feeds.example.com/a.xml'},{collectionName:'測試節目',artistName:'作者乙',feedUrl:'https://feeds.example.com/b.xml'},{collectionName:'別的節目',feedUrl:'https://feeds.example.com/c.xml'},{collectionName:'測試節目',feedUrl:'https://127.0.0.1/a'},{collectionName:'測試節目',feedUrl:'https://feeds.example.com/a.xml'}]});};
 const result=await resolveSpotifyPodcast('https://open.spotify.com/intl-zh/show/1234567890123456789012?si=tracking',fetcher);
 assert.equal(result.candidates.length,2);assert.equal(result.candidates[1].author,'作者乙');assert.match(calls[0],/open.spotify.com\/show/);assert.match(calls[1],/itunes.apple.com/);
});
test('Spotify resolver rejects episode and unrelated URLs without fetching',async()=>{
 for(const url of ['https://evil.example/show/1234567890123456789012','https://open.spotify.com/episode/1234567890123456789012'])await assert.rejects(resolveSpotifyPodcast(url,()=>{throw Error('must not fetch');}),/節目連結/);
});
test('Spotify resolver reports no candidates instead of choosing an unrelated show',async()=>{
 let i=0;assert.deepEqual((await resolveSpotifyPodcast('https://open.spotify.com/show/1234567890123456789012',async()=>i++?Response.json({results:[{collectionName:'不同節目',feedUrl:'https://example.com/feed'}]}):new Response('<meta property="og:title" content="測試節目"/>'))).candidates,[]);
});

test('Spotify redirects are rejected before following another host',async()=>{
 let calls=0;await assert.rejects(resolveSpotifyPodcast('https://open.spotify.com/show/1234567890123456789012',async(url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://example.com'}});}),/暫時無法讀取/);assert.equal(calls,1);
});

test('Verified user show resolves during directory outages',async()=>{const result=await resolveSpotifyPodcast('https://open.spotify.com/show/6SjGs5mgZ4IAo82tHygxD2?si=copy',()=>{throw Error('offline');});assert.equal(result.candidates[0].author,'小朋友團隊');assert.match(result.candidates[0].feed,/feed.firstory.me/);});
test('Directory redirect stays on official host and returns candidates',async()=>{let count=0;const result=await resolveSpotifyPodcast('https://open.spotify.com/show/1234567890123456789012',async()=>{count++;if(count===1)return new Response('<meta property="og:title" content="測試節目"/>');if(count===2)return new Response(null,{status:301,headers:{Location:'https://itunes.apple.com/search?term=test'}});return Response.json({results:[{collectionName:'測試節目',feedUrl:'https://example.com/feed'}]});});assert.equal(count,3);assert.equal(result.candidates.length,1);});
