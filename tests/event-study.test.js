import test from 'node:test';import assert from 'node:assert/strict';import {studyEvent,eventCategory} from '../src/event-study.js';
const dates=['2026-09-25','2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-05'];const prices=dates.flatMap((date,i)=>[{code:'2303',date,close:100+i},{code:'TAIEX',date,close:1000+i*2}]);
test('after close and weekend anchor next session; baseline is previous close',()=>{for(const time of ['2026-10-02T06:30:00Z','2026-10-03T02:00:00Z']){const x=studyEvent({company_code:'2303',title:'營收成長',published_at:time},prices);assert.equal(x.date,'2026-10-05');assert.equal(x.baseline,'2026-10-02');assert.equal(x.returns[0].stock,(106/105-1)*100);assert.equal(x.returns[1].stock,undefined);assert.ok(x.returns[0].excess>0);}});
test('intraday anchors same session; missing baseline does not fabricate',()=>{assert.equal(studyEvent({company_code:'2303',published_at:'2026-10-02T02:00:00Z',title:''},prices).date,'2026-10-02');assert.equal(studyEvent({company_code:'2303',published_at:'2026-09-25T02:00:00Z',title:''},prices),null);assert.equal(eventCategory('法說會'),'法說');});


test('same stock and publication day within the same session share all price returns',()=>{
 const news={company_code:'2303',title:'新聞'};
 const morning=studyEvent({...news,published_at:'2026-09-28T01:00:00Z'},prices);
 const noon=studyEvent({...news,published_at:'2026-09-28T05:29:00Z',title:'另一則新聞'},prices);
 assert.deepEqual(morning.returns,noon.returns);assert.equal(morning.baseline,noon.baseline);assert.equal(morning.baselineClose,noon.baselineClose);
 const close=studyEvent({...news,published_at:'2026-09-28T05:30:00Z'},prices);
 assert.equal(close.date,'2026-09-29');assert.equal(close.baseline,'2026-09-28');assert.equal(close.afterClose,true);assert.notEqual(close.returns[0].stock,morning.returns[0].stock);
 assert.equal(morning.returns[0].date,morning.date);assert.equal(morning.returns[1].date,'2026-09-30');
});
