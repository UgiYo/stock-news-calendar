import importlib.util
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

spec=importlib.util.spec_from_file_location('bridge',Path(__file__).with_name('app.py'))
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)

class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();root=Path(self.temp.name)
        self.key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        (root/'key.pem').write_bytes(self.key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        import json
        jwk=json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()));jwk['kid']='worker'
        (root/'public.json').write_text(json.dumps({'keys':[jwk]}))
        self.cfg={'FLASK_SECRET_KEY':'x'*64,'LDAP_HOST':'dc.example','LDAP_PORT':'3269','LDAP_TLS_MODE':'ldaps','LDAP_CA_FILE':'ca.pem','LDAP_LOGIN_TEMPLATE':'{username}@example','LDAP_BASE_DN':'DC=example','LDAP_ALLOW_ALL_USERS':'true','COMPANY_ISSUER':'company','INTERNAL_LOGIN_URL':'https://inside.example/login','WORKER_ORIGIN':'https://worker.example','APP_URL':'https://example.com/','WORKER_REQUEST_JWKS_FILE':str(root/'public.json'),'COMPANY_SIGNING_KEY_FILE':str(root/'key.pem'),'COMPANY_SIGNING_KID':'company','RATE_DB':str(root/'rates.db')}
        self.app=bridge.create_app(self.cfg);self.client=self.app.test_client()
    def tearDown(self):self.temp.cleanup()
    def begin(self,**change):
        now=int(time.time());c=dict(iss='https://worker.example',aud='company',iat=now,exp=now+60,transaction='a'*64,state='s'*43,redirect_uri='https://example.com/');c.update(change)
        token=jwt.encode(c,self.key,algorithm='RS256',headers={'kid':'worker','typ':'JWT'})
        return self.client.get('/login',query_string={'request':token},base_url='https://inside.example')
    def form_data(self):
        with self.client.session_transaction(base_url='https://inside.example') as s:return {'csrf':s['csrf'],'username':'employee','password':'test-password'}
    def test_invalid_request_and_csrf(self):
        self.assertEqual(self.begin(aud='wrong').status_code,400)
        self.assertEqual(self.begin(redirect_uri='https://evil.example/').status_code,400)
        self.assertEqual(self.begin().status_code,303)
        with patch.object(bridge,'authenticate') as auth:
            self.assertEqual(self.client.post('/login/form',data={'csrf':'bad'},base_url='https://inside.example',headers={'Origin':'https://inside.example'}).status_code,403);auth.assert_not_called()
    def test_verified_password_never_sent_to_worker_and_transaction_replay_rejected(self):
        self.begin();data=self.form_data()
        class Result:
            status_code=200
            def json(self):return {'code':'c'*64}
        with patch.object(bridge,'authenticate',return_value={'sub':'a'*32,'name':'Employee'}) as auth,patch.object(bridge.requests,'post',return_value=Result()) as post:
            r=self.client.post('/login/form',data=data,base_url='https://inside.example',headers={'Origin':'https://inside.example'})
            self.assertEqual(r.status_code,303);self.assertIn('#company_code=',r.location)
            self.assertEqual(auth.call_count,1);self.assertEqual(auth.call_args.args[:2],('employee','test-password'))
            payload=post.call_args.kwargs['json'];self.assertEqual(list(payload),['assertion'])
            claims=jwt.decode(payload['assertion'],self.key.public_key(),algorithms=['RS256'],audience='https://worker.example');self.assertNotIn('password',claims)
            self.begin();r=self.client.post('/login/form',data=self.form_data(),base_url='https://inside.example',headers={'Origin':'https://inside.example'});self.assertEqual(r.status_code,409)
    def test_empty_password_and_tls_downgrade_rejected(self):
        with self.assertRaises(ValueError):bridge.authenticate('employee','',self.cfg)
        with self.assertRaises(RuntimeError):bridge.create_app({**self.cfg,'LDAP_TLS_MODE':'none'})
    def test_ldap_tls_and_bind_fail_closed(self):
        from unittest.mock import MagicMock
        conn=MagicMock();conn.start_tls.return_value=False
        with patch.object(bridge,'Tls') as tls,patch.object(bridge,'Server'),patch.object(bridge,'Connection',return_value=conn):
            with self.assertRaises(ValueError):bridge.authenticate('employee','secret',{**self.cfg,'LDAP_TLS_MODE':'starttls'})
            self.assertEqual(tls.call_args.kwargs['validate'],bridge.ssl.CERT_REQUIRED);conn.bind.assert_not_called();conn.unbind.assert_called_once()
        conn=MagicMock();conn.bind.return_value=False
        with patch.object(bridge,'Tls'),patch.object(bridge,'Server'),patch.object(bridge,'Connection',return_value=conn):
            with self.assertRaises(ValueError):bridge.authenticate('employee','secret',self.cfg)
            conn.search.assert_not_called()
if __name__=='__main__':unittest.main()
