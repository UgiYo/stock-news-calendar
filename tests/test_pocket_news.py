import datetime
import html
import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

class PocketNewsTests(unittest.TestCase):
 def setUp(self):
  spec=importlib.util.spec_from_file_location('pocket_collector',Path(__file__).parents[1]/'scripts/collect.py');self.m=importlib.util.module_from_spec(spec)
  with patch.dict(os.environ,{'WORKER_API_URL':'https://fixture.invalid','COLLECTOR_SECRET':'fixture'}):spec.loader.exec_module(self.m)
  self.now=datetime.datetime(2026,10,14,8,tzinfo=datetime.timezone.utc);self.start=self.now-datetime.timedelta(days=32)
 def test_market_boundary_and_adr_identity(self):
  cases=[('台積電（2330）法說','2330',True),('台積電（2330）法說','US:TSM',False),('台積電ADR（TSM）財報','US:TSM',True),('台積電ADR（TSM）財報','2330',False),('台積電營收','US:TSM',False),('台股輝達供應鏈','US:NVDA',False),('台股 NVDA 供應鏈','US:NVDA',True)]
  for title,code,want in cases:self.assertEqual(self.m.pocket_market_matches(title,code),want,(title,code))
  self.assertEqual(self.m.trusted_domain('https://pocket.tw'),'口袋證券');self.assertIsNone(self.m.trusted_domain('https://www.pocket.tw.evil.test'))
 def test_native_rows_use_valid_articles_and_preserve_date_only_precision(self):
  company={'code':'2330','name':'台積電','full_name':'台灣積體電路'}
  row={'Title':'台積電（2330）法說','date':'2026-10-14','slug':'/school/report/newflash/8001/','kind':'口袋快訊'}
  data={'code':'0','pages':1,'data':[row,{**row,'date':'2026-10-15'},{**row,'date':'2026-08-01'},{**row,'date':'2026-02-30'},{**row,'slug':'/announcement/1/'}]}
  results=self.m.pocket_index_rows(data,company,self.start,self.now,[]);self.assertEqual(len(results),1);self.assertEqual(results[0]['published_at'],'2026-10-14');self.assertEqual(results[0]['company_code'],'2330')
  adr={'code':'US:TSM','name':'台積電 ADR','full_name':'Taiwan Semiconductor Manufacturing'};self.assertEqual(self.m.pocket_index_rows(data,adr,self.start,self.now,[]),[])
 def test_encoded_component_extraction_omits_page_chrome(self):
  text='<p>這是文章正文與股票營運說明。</p>\\r\\n<p>第二段資訊。</p>'
  raw='<nav>導航內容</nav><InvestNewsContent data-title="測試文章" data-date="2026-10-14" data-news_type="口袋快訊" data-content="'+html.escape(text,quote=True)+'"></InvestNewsContent><footer>客服內容</footer>'
  fields=self.m.pocket_article_fields(raw);self.assertEqual(fields['date'],'2026-10-14');self.assertIn('第二段',fields['content']);self.assertNotIn('導航',fields['content']);self.assertNotIn('客服',fields['content'])
 def test_native_index_pagination_and_cache(self):
  company={'code':'US:MSFT','name':'微軟','full_name':'Microsoft'};calls=[]
  class Response:
   status_code=200
   def __init__(self,page):self.page=page
   def raise_for_status(self):pass
   def json(self):return {'code':'0','pages':100,'data':[{'Title':'微軟財報','date':'2026-10-14' if self.page==1 else '2026-08-01','slug':'/school/report/SB/8002/'}]}
  def get(url,**kwargs):calls.append(kwargs);self.assertFalse(kwargs['allow_redirects']);return Response(kwargs['params']['page'])
  with patch.object(self.m.requests,'get',side_effect=get):
   diagnostics={'requests':0};rows=self.m.collect_pocket(company,self.start,self.now,[],diagnostics);again=self.m.collect_pocket(company,self.start,self.now,[],diagnostics)
  self.assertEqual(len(rows),1);self.assertEqual(rows,again);self.assertEqual(len(calls),6);self.assertEqual(diagnostics['requests'],6);self.assertTrue(all(c['params']['page']<=2 for c in calls))
 def test_duplicate_article_retains_precise_rss_time_and_native_url(self):
  base={'company_code':'US:MSFT','source':'口袋證券','title':'微軟營收成長10%'}
  rows=self.m.curate_news([{**base,'url':'https://news.google.com/rss/articles/a','title':base['title']+' - 口袋學堂','published_at':'2026-10-13T18:00:00+00:00','news_date':'2026-10-13'},{**base,'url':'https://www.pocket.tw/school/report/SB/8002/','published_at':'2026-10-14','news_date':'2026-10-14'}])
  self.assertEqual(len(rows),1);self.assertEqual(rows[0]['article_url'],'https://www.pocket.tw/school/report/SB/8002/');self.assertEqual(rows[0]['published_at'],'2026-10-13T18:00:00+00:00')

if __name__=='__main__':unittest.main()
