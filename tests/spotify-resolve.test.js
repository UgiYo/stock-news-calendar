import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSpotifyPodcast} from '../worker/podcasts.js';
test('Spotify lookup keeps matching shows and authors, removes unsafe feeds and duplicates',async()=>{
 const calls=[];const fetcher=async(url)=>{calls.push(url);return Response.json(calls.length===1?{title:'測試節目'}:{results:[{collectionName:'測試節目',artistName:'作者甲',feedUrl:'https://feeds.example.com/a.xml'},{collectionName:'測試節目',artistName:'作者乙',feedUrl:'https://feeds.example.com/b.xml'},{collectionName:'別的節目',feedUrl:'https://feeds.example.com/c.xml'},{collectionName:'測試節目',feedUrl:'https://127.0.0.1/a'},{collectionName:'測試節目',feedUrl:'https://feeds.example.com/a.xml'}]});};
 const result=await resolveSpotifyPodcast('https://open.spotify.com/intl-zh/show/1234567890123456789012?si=tracking',fetcher);
 assert.equal(result.candidates.length,2);assert.equal(result.candidates[1].author,'作者乙');assert.match(calls[0],/oembed/);assert.match(calls[1],/itunes.apple.com/);
});
test('Spotify resolver rejects episode and unrelated URLs without fetching',async()=>{
 for(const url of ['https://evil.example/show/1234567890123456789012','https://open.spotify.com/episode/1234567890123456789012'])await assert.rejects(resolveSpotifyPodcast(url,()=>{throw Error('must not fetch');}),/節目連結/);
});
test('Spotify resolver reports no candidates instead of choosing an unrelated show',async()=>{
 let i=0;assert.deepEqual((await resolveSpotifyPodcast('https://open.spotify.com/show/1234567890123456789012',async()=>Response.json(i++?{results:[{collectionName:'不同節目',feedUrl:'https://example.com/feed'}]}:{title:'測試節目'}))).candidates,[]);
});
