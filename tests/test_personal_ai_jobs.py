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
 def test_podcast_correction_rules_reach_chunks_and_merge_without_changing_source(self):
  source='台積電的先進支程。'*3000
  output={'text':source}
  with patch.object(jobs,'update'),patch.object(jobs,'call_provider',return_value='校正摘要；待確認數字') as provider:
   jobs.summarize({},source,'EP',True,{},output,podcast=True)
   self.assertEqual(provider.call_count,3)
   for call in provider.call_args_list:
    self.assertIn(jobs.PODCAST_SUMMARY_RULES,call.kwargs['prompt'])
    self.assertIn('僅提供部分內容',call.kwargs['prompt'])
   self.assertIn('校正摘要；待確認數字',provider.call_args.kwargs['prompt'])
   self.assertEqual(output['text'],source)
 def test_news_does_not_use_podcast_correction_rules(self):
  with patch.object(jobs,'update'),patch.object(jobs,'call_provider',return_value='新聞摘要') as provider:
   jobs.summarize({},'新聞內文','News',False,{}, {})
   self.assertNotIn(jobs.PODCAST_SUMMARY_RULES,provider.call_args.kwargs['prompt'])
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
