import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findAssistantCompany,assistantSources} from '../src/assistant-sources.js';
const companies=[{code:'2327',name:'國巨*'},{code:'2330',name:'台積電'}];
test('assistant matches stock names without exchange suffix and exact ticker',()=>{assert.equal(findAssistantCompany('國巨新聞',companies)[0].code,'2327');assert.equal(findAssistantCompany('問2327',companies)[0].code,'2327');assert.equal(findAssistantCompany('123270',companies).length,0);});
test('assistant sources include matching stock news and transcript evidence only',()=>{const rows=assistantSources('國巨',{companies,news:[{company_code:'2327',title:'國巨新消息',news_date:'2026-10-07',url:'https://news.example/a'},{company_code:'2330',title:'其他新聞'}],records:[{kind:'podcast',title:'本集',date:'2026-10-01',text:'國巨被提及',partial:true},{kind:'podcast',title:'其他集',text:'其他主題'}]});assert.equal(rows.length,2);assert.equal(rows[0].id,'S1');assert.match(rows[1].text,/部分逐字稿/);});
