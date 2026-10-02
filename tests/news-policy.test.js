import test from 'node:test';
import assert from 'node:assert/strict';
import {curateNews,duplicateNews,sourceDomain} from '../src/news-policy.js';
import {curateNews as workerCurate} from '../worker/index.js';
const row=(title,source='中央社',url='https://example.com/a',extra={})=>({company_code:'2303',title,source,url,published_at:'2026-10-02T01:00:00Z',...extra});
test('allowlist and deduplication agree across frontend and Worker',()=>{
 const rows=[row('聯電營收成長10% - 中央社'),row('聯電營收成長10% - 鉅亨網','鉅亨網','https://example.com/b'),row('聯電消息','未知來源'),row('聯電營收成長12%','MoneyDJ理財網','https://example.com/c')];
 assert.equal(curateNews(rows).length,2);assert.deepEqual(curateNews(rows),workerCurate(rows));assert.equal(sourceDomain('https://www.cna.com.tw.attacker.example'),null);
});
test('preserve different figures, companies, dates and material new titles',()=>{
 const a=row('聯電營收成長10.2%');assert.equal(duplicateNews(a,row('聯電營收成長1.02%','中央社','https://example.com/b')),false);
 assert.equal(duplicateNews(a,row(a.title,'中央社','https://example.com/b',{company_code:'2330'})),false);
 assert.equal(duplicateNews(a,row(a.title,'中央社','https://example.com/b',{published_at:'2026-09-01T01:00:00Z'})),false);
 assert.equal(duplicateNews(a,row('聯電新增海外廠投資計畫','中央社','https://example.com/b')),false);
});
test('company names embedded in other companies are not relevant',async()=>{
 const {companyMention}=await import('../src/news-policy.js');const c={code:'2303',name:'聯電',full_name:'聯華電子'};
 assert.equal(companyMention('台聯電營收成長',c),false);
 assert.equal(companyMention('台聯電與聯電合作',c),true);
 assert.equal(companyMention('2303 聯電法說會',c),true);
 assert.equal(companyMention('台聯電12303營收成長',c),false);
 assert.equal(companyMention('大華電子營收',{code:'9999',name:'華電',full_name:'華電公司'},['大華電子']),false);
});
