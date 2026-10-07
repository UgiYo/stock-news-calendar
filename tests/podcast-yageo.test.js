import {test} from 'node:test';
import assert from 'node:assert/strict';
import {podcastMentions,podcastMentionIndex} from '../src/podcast-mentions.js';
const record={kind:'podcast',id:'podcast:oct1',owner:'fixture',title:'10/1',date:'2026-10-01',state:'complete',text:'[0～5 分鐘]\n國巨在被動元件漲價循環中受到討論。',answer:'國巨的被動元件需求。'};
const stock={code:'2327',name:'國巨*',full_name:'國巨股份有限公司'};
test('exchange asterisk does not block Yageo transcript and summary mentions',()=>{const rows=podcastMentions(record,[stock]);assert.equal(rows.length,1);assert.equal(rows[0].code,'2327');assert.equal(rows[0].passages.length,1);assert.equal(rows[0].evidence[0].time,'[0～5 分鐘]');});
test('adding stock invalidates prior empty mention cache and selected calendar index matches',()=>{assert.equal(podcastMentions(record,[]).length,0);assert.equal(podcastMentions(record,[stock]).length,1);assert.equal(podcastMentionIndex([record],[stock],'2327').get('2026-10-01')[0].stocks[0].code,'2327');});
