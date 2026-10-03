import os,sys,json,unittest,base64,hashlib,importlib.util
from unittest.mock import patch
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
os.environ.setdefault('WORKER_API_URL','https://worker.example');os.environ.setdefault('COLLECTOR_SECRET','fixture-secret')
spec=importlib.util.spec_from_file_location('personal_jobs',os.path.join(os.path.dirname(__file__),'../scripts/personal_ai_jobs.py'));jobs=importlib.util.module_from_spec(spec);spec.loader.exec_module(jobs)
class PersonalJobs(unittest.TestCase):
 def test_decrypt_binds_ciphertext_to_job(self):
  iv=b'123456789012';id='job';key=hashlib.sha256(('personal-ai-jobs-v1:'+jobs.SECRET).encode()).digest();data=AESGCM(key).encrypt(iv,json.dumps({'config':{'key':'private'}}).encode(),id.encode());task={'id':id,'encrypted':{'iv':base64.b64encode(iv).decode(),'data':base64.b64encode(data).decode()}}
  self.assertEqual(jobs.decrypt_task(task)['config']['key'],'private');task['id']='other'
  with self.assertRaises(Exception):jobs.decrypt_task(task)
 def test_partial_news_uses_only_successful_bodies(self):
  output={};rows=[{'title':'good','url':'https://www.cna.com.tw/one'},{'title':'bad','url':'https://www.cna.com.tw/two'}]
  def fake_api(path,body=None):
   if body['url'].endswith('two'):raise ValueError('blocked')
   return {'url':body['url'],'text':'Full article body'}
  with patch.object(jobs,'api',side_effect=fake_api),patch.object(jobs,'update'),patch.object(jobs,'summarize',return_value='summary') as summary:
   jobs.process_news({'title':'Daily'},{},{'rows':rows},output)
   self.assertEqual(len(output['articles']),1);self.assertTrue(output['partial']);self.assertEqual(len(output['failures']),1);self.assertNotIn('bad',summary.call_args.args[1])
 def test_missing_backend_does_not_break_legacy_collector(self):
  response=jobs.requests.Response();response.status_code=404
  with patch.object(jobs,'api',side_effect=jobs.requests.HTTPError(response=response)):jobs.main()
 def test_provider_redirect_does_not_forward_key(self):
  config={'provider':'openai','endpoint':'https://api.openai.com/v1','key':'private','model':'model'}
  response=jobs.requests.Response();response.status_code=302;response._content=b'{}'
  with patch.object(jobs.requests,'post',return_value=response) as post,patch.object(jobs.time,'sleep'):
   with self.assertRaises(ValueError):jobs.call_provider(config,prompt='content')
   self.assertFalse(post.call_args.kwargs['allow_redirects'])
if __name__=='__main__':unittest.main()
