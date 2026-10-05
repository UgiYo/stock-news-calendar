import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from unittest.mock import Mock

root = Path(__file__).parents[1]
def module(name, path):
    spec=importlib.util.spec_from_file_location(name,path)
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
jobs=module('local_jobs',root/'tools/local_ai_jobs.py')
bridge=module('bridge_jobs',root/'tools/local_ai_bridge.py')
config={'provider':'litellm','endpoint':'https://company.example/v1','model':'model','key':'gateway-secret'}

class LocalJobsTests(unittest.TestCase):
    def create(self, directory, chat):
        return jobs.LocalJobs(directory,chat,Mock(side_effect=AssertionError('unexpected transcription')),Mock(side_effect=AssertionError('unexpected public news request')),Mock())

    def test_background_finishes_without_client_and_never_persists_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            started,release=threading.Event(),threading.Event()
            def chat(c,text):
                started.set();release.wait(5)
                self.assertEqual(c['key'],'gateway-secret')
                self.assertIn('先理解前後文',text)
                return '本機摘要'
            engine=self.create(directory,chat)
            row=engine.submit({'kind':'podcast','title':'EP','input':{'text':'公司逐字稿'*50,'action':'summarize'},'untrusted_config':config},config)
            self.assertTrue(started.wait(3));self.assertEqual(engine.get(row['id'])['state'],'running')
            self.assertNotIn('gateway-secret',json.dumps(engine.list()))
            release.set();engine.queue.join()
            self.assertEqual(engine.get(row['id'])['answer'],'本機摘要')
            self.assertEqual(engine.keys,{})
            self.assertNotIn(b'gateway-secret',(Path(directory)/'results.sqlite3').read_bytes())
            restarted=self.create(directory,Mock())
            self.assertEqual(restarted.get(row['id'])['state'],'complete')

    def test_resume_preserves_checkpoint_and_marks_unfinished_on_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            engine=self.create(directory,Mock(return_value='summary'))
            engine.save(dict(id='old',kind='podcast',state='running',title='EP',text='已有逐字稿'*30,segments=[],action='summarize',partial=True,read_at=None))
            restarted=self.create(directory,Mock(return_value='resumed'))
            self.assertEqual(restarted.get('old')['state'],'interrupted')
            self.assertEqual(restarted.keys,{})
            restarted.action('old','resume',config);restarted.queue.join()
            self.assertEqual(restarted.get('old')['answer'],'resumed')
            self.assertEqual(restarted.get('old')['text'],'已有逐字稿'*30)

    def test_cancel_and_delete_do_not_resurrect_late_provider_response(self):
        with tempfile.TemporaryDirectory() as directory:
            started,release=threading.Event(),threading.Event()
            def chat(c,t):started.set();release.wait(5);return 'late output'
            engine=self.create(directory,chat)
            row=engine.submit({'kind':'text','input':{'text':'secret document'}},config)
            self.assertTrue(started.wait(3));engine.action(row['id'],'delete');release.set();engine.queue.join()
            self.assertEqual(engine.list(),[]);self.assertEqual(engine.keys,{})

    def test_errors_do_not_persist_provider_exception_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            engine=self.create(directory,Mock(side_effect=RuntimeError('gateway-secret')))
            row=engine.submit({'kind':'text','input':{'text':'doc'}},config);engine.queue.join()
            self.assertEqual(engine.get(row['id'])['state'],'interrupted')
            self.assertNotIn('gateway-secret',json.dumps(engine.list()))
            self.assertEqual(engine.keys,{})

    def test_job_api_pairing_gate_and_company_only_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            engine=self.create(directory,Mock(return_value='ok'))
            server=ThreadingHTTPServer(('127.0.0.1',0),bridge.Handler);server.local_jobs=engine;server.ca_file=None
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            url='http://127.0.0.1:'+str(server.server_port)+'/local-jobs'
            def call(body,token=None,origin=None):
                headers={'Content-Type':'application/json'}
                if token:headers['X-Local-AI-Token']=token
                if origin:headers['Origin']=origin
                req=urllib.request.Request(url,data=json.dumps(body).encode(),headers=headers)
                try:
                    with urllib.request.urlopen(req) as response:return response.status,json.load(response)
                except urllib.error.HTTPError as e:return e.code, json.load(e)
            try:
                self.assertEqual(call({'action':'list'})[0],401)
                self.assertEqual(call({'action':'list'},bridge.TOKEN,'https://evil.example')[0],403)
                self.assertEqual(call({'action':'list'},bridge.TOKEN)[0],200)
                self.assertEqual(call({'kind':'text','input':{'text':'doc'},'config':{**config,'provider':'openai'}},bridge.TOKEN)[0],400)
                status,data=call({'kind':'text','input':{'text':'doc'},'config':config},bridge.TOKEN)
                self.assertEqual(status,202);engine.queue.join()
                self.assertNotIn('gateway-secret',json.dumps(call({'action':'list'},bridge.TOKEN)))
            finally:server.shutdown();server.server_close()

if __name__=='__main__':unittest.main()
