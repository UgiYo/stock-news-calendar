import {test} from 'node:test';
import assert from 'node:assert/strict';
import {marketOpen,mergeLiveBars} from '../src/live-candles.js';
test('Taiwan market window excludes nights and weekends',()=>{
 for(const [time,expected] of [['2026-10-07T08:59:00+08:00',false],['2026-10-07T09:00:00+08:00',true],['2026-10-07T13:30:00+08:00',true],['2026-10-07T13:31:00+08:00',false],['2026-10-10T10:00:00+08:00',false]])assert.equal(marketOpen(new Date(time)),expected);
});
test('live bars replace matching dates and retain history',()=>{
 assert.deepEqual(mergeLiveBars([{date:'2026-10-05',close:10},{date:'2026-10-06',close:11}],[{date:'2026-10-06',close:12},{date:'2026-10-07',close:13}]),[{date:'2026-10-05',close:10},{date:'2026-10-06',close:12},{date:'2026-10-07',close:13}]);
});
