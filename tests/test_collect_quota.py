import importlib.util
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

class QuotaTests(unittest.TestCase):
 def setUp(self):
  self.fake=types.SimpleNamespace(request=None)
  spec=importlib.util.spec_from_file_location('collector',Path(__file__).parents[1]/'scripts/collect.py')
  self.module=importlib.util.module_from_spec(spec)
  with patch.dict(sys.modules,{'requests':self.fake}),patch.dict(os.environ,{'WORKER_API_URL':'https://example.com','COLLECTOR_SECRET':'fixture'}):spec.loader.exec_module(self.module)
 def test_quota_response_is_explicit_without_secret_and_no_retry(self):
  for code,kind in [('D1_READ_QUOTA','read'),('D1_WRITE_QUOTA','write')]:
   response=types.SimpleNamespace(ok=False,json=lambda:{'code':code,'reset_at':'2026-10-07T00:00:00Z'})
   with patch.object(self.fake,'request',return_value=response) as request:
    with self.assertRaises(self.module.CollectorQuotaError) as result:self.module.api('/admin/news',{'news':[]})
    self.assertIn(kind,str(result.exception));self.assertIn('2026-10-07 08:00',str(result.exception));self.assertNotIn('fixture',str(result.exception));request.assert_called_once()
 def test_quota_does_not_attempt_error_status_write(self):
  c={'code':'2330'};calls=[]
  def api(path,body=None):
   calls.append(path)
   if path=='/admin/tracked':return {'companies':[c]}
   self.fail('Unexpected error status write: '+path)
  def collect(_):raise self.module.CollectorQuotaError('D1_WRITE_QUOTA','2026-10-07T00:00:00Z')
  with patch.object(self.module,'api',side_effect=api),patch.object(self.module,'collect',side_effect=collect),patch.dict(os.environ,{'RUN_MODE':'daily'}):
   with self.assertRaises(self.module.CollectorQuotaError):self.module.main()
  self.assertEqual(calls,['/admin/tracked'])
if __name__=='__main__':unittest.main()
