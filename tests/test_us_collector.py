import datetime
import email.utils
import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

class USCollectorTests(unittest.TestCase):
 def setUp(self):
  spec=importlib.util.spec_from_file_location('us_collector',Path(__file__).parents[1]/'scripts/collect.py')
  self.collector=importlib.util.module_from_spec(spec)
  with patch.dict(os.environ,{'WORKER_API_URL':'https://fixture.invalid','COLLECTOR_SECRET':'fixture'}):spec.loader.exec_module(self.collector)
 def test_us_aliases_and_short_symbols(self):
  c={'code':'US:NVDA','name':'輝達','full_name':'NVIDIA'}
  self.assertTrue(self.collector.company_mention('NVIDIA earnings',c,[]))
  self.assertFalse(self.collector.company_mention('XNVDA token',c,[]))
  self.assertFalse(self.collector.company_mention('arm injury',{'code':'US:ARM','name':'安謀','full_name':'Arm Holdings'},[]))
 def test_us_collection_uses_english_sources_and_eastern_date(self):
  c={'code':'US:NVDA','name':'輝達','full_name':'NVIDIA'};now=datetime.datetime.now(datetime.timezone.utc)
  published=(now-datetime.timedelta(days=1)).replace(hour=1,minute=0,second=0,microsecond=0)
  xml=f'<rss><channel><item><title>NVIDIA earnings update</title><link>https://www.reuters.com/nvidia</link><pubDate>{email.utils.format_datetime(published)}</pubDate><source url="https://www.reuters.com">Reuters</source></item></channel></rss>'
  class Response:
   ok=True;status_code=200;content=xml.encode()
  calls=[]
  def api(path,body=None):
   calls.append((path,body));return {'names':[]} if path.startswith('/admin/company-aliases') else {'ok':True}
  with patch.object(self.collector,'api',side_effect=api),patch.object(self.collector.requests,'get',return_value=Response()) as get,patch.object(self.collector.time,'sleep'):
   details={};self.collector.collect(c,details)
  self.assertEqual(details['collected'],1)
  row=next(body['news'][0] for path,body in calls if path=='/admin/news')
  self.assertEqual(row['news_date'],published.astimezone(self.collector.US).date().isoformat())
  self.assertEqual(row['source'],'Reuters');self.assertEqual(row['company_code'],'US:NVDA')
  self.assertTrue(all(call.kwargs['params']['hl']=='en-US' for call in get.call_args_list if 'news.google.com' in call.args[0]))
