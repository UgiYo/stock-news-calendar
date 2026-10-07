import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pendingPodcastEpisodes} from '../src/podcast-auto.js';
test('auto queue skips complete episodes, keeps transcript-only and partial history, latest first',()=>{
 const episodes=[{id:'old',date:'2026-09-01'},{id:'new',date:'2026-10-07'},{id:'done',date:'2026-10-01'}];
 const rows=[{id:'podcast:done',text:'稿',answer:'摘要',partial:false,state:'complete'},{id:'podcast:old',text:'部分',answer:'摘要',partial:true,state:'complete'}];
 assert.deepEqual(pendingPodcastEpisodes(episodes,rows).map(e=>e.id),['new','old']);
 assert.deepEqual(pendingPodcastEpisodes(episodes,rows,new Set(['podcast:new'])).map(e=>e.id),['old']);
 assert.equal(pendingPodcastEpisodes([{id:'transcript',date:'2026-10-01'}],[{id:'podcast:transcript',text:'逐字稿',answer:'',state:'complete'}]).length,1);
});
