import {test} from 'node:test';
import assert from 'node:assert/strict';
import {brokerReports} from '../src/broker-reports.js';
const news=title=>[{company_code:'2330',title,news_date:'2026-10-07',url:'https://news.example'}];
test('broker target increase retains old and new price',()=>{const r=brokerReports(news('大摩將台積電目標價由1,200元調高至1,500元，維持買進評等'))[0];assert.equal(r.broker,'摩根士丹利');assert.equal(r.target,1500);assert.equal(r.previous,1200);assert.equal(r.rating,'買進');});
test('anonymous broker stays anonymous and multi-broker attribution stays unresolved',()=>{assert.equal(brokerReports(news('外資給予台積電目標價至1500元'))[0].broker,'未具名外資／券商');assert.ok(brokerReports(news('高盛與瑞銀看好台積電，目標價1500元')).every(r=>r.target===null));});
test('unrelated current share price is not mistaken for target price',()=>{const r=brokerReports(news('高盛發布台積電報告，今日股價1200元'))[0];assert.equal(r.target,null);});
