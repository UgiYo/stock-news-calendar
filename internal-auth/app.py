"""Internal-only LDAP bridge. Never log request bodies or LDAP credentials."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import ssl
import time
import uuid
from urllib.parse import urlencode, urlparse

import jwt
import requests
from flask import Flask, abort, redirect, render_template_string, request, session
from ldap3 import Server, Connection, Tls, SIMPLE, SUBTREE, NONE
from ldap3.utils.conv import escape_filter_chars

FORM='''<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>公司帳號登入</title><style>body{font:16px system-ui;max-width:400px;margin:10vh auto;padding:24px}label,input,button{display:block;margin:12px 0;width:100%;box-sizing:border-box}input,button{padding:12px}small{color:#555}</style><h1>公司帳號登入</h1><small>帳密僅送至公司內網驗證，不保存密碼。</small><p role="alert">{{ error }}</p><form method="post"><input type="hidden" name="csrf" value="{{ csrf }}"><label>公司帳號<input name="username" maxlength="80" autocomplete="username" required></label><label>密碼<input type="password" name="password" maxlength="1024" autocomplete="current-password" required></label><button>登入</button></form></html>'''


def authenticate(username, password, cfg):
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,80}', username) or not password or len(password)>1024:
        raise ValueError('Invalid credentials')
    mode=cfg['LDAP_TLS_MODE']
    if mode not in ('ldaps','starttls'):
        raise ValueError('TLS required')
    tls=Tls(validate=ssl.CERT_REQUIRED, ca_certs_file=cfg['LDAP_CA_FILE'])
    server=Server(cfg['LDAP_HOST'],port=int(cfg['LDAP_PORT']),use_ssl=mode=='ldaps',tls=tls,get_info=NONE,connect_timeout=5)
    login=cfg['LDAP_LOGIN_TEMPLATE'].replace('{username}',username)
    conn=Connection(server,user=login,password=password,authentication=SIMPLE,version=3,auto_referrals=False,read_only=True,receive_timeout=8)
    try:
        conn.open()
        if mode=='starttls' and not conn.start_tls():
            raise ValueError('TLS failed')
        if not conn.bind():
            raise ValueError('Invalid credentials')
        group=cfg.get('LDAP_ALLOWED_GROUP_DN','')
        if not group and cfg.get('LDAP_ALLOW_ALL_USERS')!='true':
            raise ValueError('Group policy required')
        search='(&(objectCategory=person)(objectClass=user)(sAMAccountName='+escape_filter_chars(username)+')'
        # AD transitive group membership; GC partial attribute behavior must be tested in the target directory.
        if group:
            search+='(memberOf:1.2.840.113556.1.4.1941:='+escape_filter_chars(group)+')'
        search+=')'
        if not conn.search(cfg['LDAP_BASE_DN'],search,SUBTREE,attributes=['objectGUID','displayName'],size_limit=2) or len(conn.entries)!=1:
            raise ValueError('User not allowed')
        row=conn.entries[0]
        raw=row['objectGUID'].raw_values[0]
        subject=uuid.UUID(bytes_le=raw).hex
        return {'sub':subject,'name':str(row['displayName'].value or username)[:100]}
    finally:
        conn.unbind()
        conn.password=None


def create_app(overrides=None):
    cfg=dict(os.environ);cfg.update(overrides or {})
    required=['FLASK_SECRET_KEY','LDAP_HOST','LDAP_PORT','LDAP_CA_FILE','LDAP_LOGIN_TEMPLATE','LDAP_BASE_DN','COMPANY_ISSUER','INTERNAL_LOGIN_URL','WORKER_ORIGIN','APP_URL','WORKER_REQUEST_JWKS_FILE','COMPANY_SIGNING_KEY_FILE','COMPANY_SIGNING_KID','RATE_DB']
    for k in required:
        if not cfg.get(k):raise RuntimeError('Missing configuration: '+k)
    if cfg.get('LDAP_TLS_MODE') not in ('ldaps','starttls'):raise RuntimeError('TLS required')
    if len(cfg['FLASK_SECRET_KEY'])<32:raise RuntimeError('FLASK_SECRET_KEY too short')
    if not cfg.get('LDAP_ALLOWED_GROUP_DN') and cfg.get('LDAP_ALLOW_ALL_USERS')!='true':raise RuntimeError('Choose allowed group or explicitly allow all users')
    for k in ['INTERNAL_LOGIN_URL','WORKER_ORIGIN','APP_URL']:
        u=urlparse(cfg[k])
        if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment:raise RuntimeError('Invalid HTTPS URL: '+k)
    if urlparse(cfg['WORKER_ORIGIN']).path not in ('','/'):raise RuntimeError('WORKER_ORIGIN must be an origin')
    keys=json.loads(Path(cfg['WORKER_REQUEST_JWKS_FILE']).read_text())['keys']
    signing_key=Path(cfg['COMPANY_SIGNING_KEY_FILE']).read_text()
    app=Flask(__name__);app.secret_key=cfg['FLASK_SECRET_KEY']
    app.config.update(MAX_CONTENT_LENGTH=12000,SESSION_COOKIE_SECURE=True,SESSION_COOKIE_HTTPONLY=True,SESSION_COOKIE_SAMESITE='Lax',PERMANENT_SESSION_LIFETIME=300)
    with sqlite3.connect(cfg['RATE_DB']) as db:
        db.execute('CREATE TABLE IF NOT EXISTS attempts(key TEXT,bucket INTEGER,count INTEGER,PRIMARY KEY(key,bucket))')
        db.execute('CREATE TABLE IF NOT EXISTS used_transactions(id TEXT PRIMARY KEY,expires INTEGER)')

    @app.after_request
    def secure(response):
        response.headers.update({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"})
        return response

    @app.route('/login',methods=['GET','POST'])
    def login():
        if request.method=='GET':
            try:
                token=request.args.get('request','')
                if len(token)>8192:raise ValueError()
                head=jwt.get_unverified_header(token)
                key=next(k for k in keys if k.get('kid')==head.get('kid') and k.get('kty')=='RSA' and 'd' not in k)
                if head.get('alg')!='RS256' or head.get('typ')!='JWT':raise ValueError()
                c=jwt.decode(token,jwt.PyJWK.from_dict(key).key,algorithms=['RS256'],audience=cfg['COMPANY_ISSUER'],issuer=cfg['WORKER_ORIGIN'].rstrip('/'),options={'require':['iat','exp','transaction','state','redirect_uri']})
                if c['exp']-c['iat']>60 or c['redirect_uri']!=cfg['APP_URL'] or not re.fullmatch(r'[-_A-Za-z0-9]{20,100}',c['transaction']) or not re.fullmatch(r'[-_A-Za-z0-9]{43}',c['state']):raise ValueError()
            except Exception:
                return '登入交易無效或已過期，請返回網站重新登入。',400
            session.clear();session.permanent=True
            session.update(transaction=c['transaction'],state=c['state'],expires=int(time.time())+240,csrf=secrets.token_urlsafe(32))
            # Remove the signed request from the visible URL and future POST URL.
            return redirect('/login/form',303)
        return submit()

    @app.route('/login/form',methods=['GET','POST'])
    def form():
        if request.method=='POST':return submit()
        if not session.get('transaction') or session.get('expires',0)<time.time():return '請返回網站重新登入。',400
        return render_template_string(FORM,error='',csrf=session['csrf'])

    def submit():
        if not session.get('transaction') or session.get('expires',0)<time.time():return '登入已過期，請重新登入。',400
        if request.headers.get('Origin')!=urlparse(cfg['INTERNAL_LOGIN_URL']).scheme+'://'+urlparse(cfg['INTERNAL_LOGIN_URL']).netloc:abort(403)
        if not hmac.compare_digest(request.form.get('csrf',''),session.get('csrf','')):abort(403)
        username=request.form.get('username','').strip();password=request.form.get('password','')
        bucket=int(time.time())//300
        with sqlite3.connect(cfg['RATE_DB']) as db:
            for value in ('ip:'+str(request.remote_addr),'user:'+username.casefold()):
                key=hashlib.sha256(value.encode()).hexdigest()
                db.execute('INSERT INTO attempts VALUES(?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET count=count+1',(key,bucket))
                count=db.execute('SELECT count FROM attempts WHERE key=? AND bucket=?',(key,bucket)).fetchone()[0]
                if count>5:return '嘗試次數過多，請五分鐘後重試。',429
            db.execute('DELETE FROM attempts WHERE bucket<?',(bucket-2,))
            db.execute('DELETE FROM used_transactions WHERE expires<?',(int(time.time()),))
            if db.execute('SELECT 1 FROM used_transactions WHERE id=?',(session['transaction'],)).fetchone():return '登入交易已使用。',409
        try:
            identity=authenticate(username,password,cfg)
        except Exception:
            return render_template_string(FORM,error='帳號、密碼或登入權限不符，或驗證服務暫時無法連線。',csrf=session['csrf']),401
        finally:
            password=None
        now=int(time.time());transaction=session['transaction']
        with sqlite3.connect(cfg['RATE_DB']) as db:
            try:db.execute('INSERT INTO used_transactions VALUES(?,?)',(transaction,now+600))
            except sqlite3.IntegrityError:return '登入交易已使用。',409
        claims=dict(identity,iss=cfg['COMPANY_ISSUER'],aud=cfg['WORKER_ORIGIN'].rstrip('/'),iat=now,exp=now+60,auth_time=now,jti=secrets.token_urlsafe(32),transaction=transaction)
        assertion=jwt.encode(claims,signing_key,algorithm='RS256',headers={'kid':cfg['COMPANY_SIGNING_KID'],'typ':'JWT'})
        try:
            result=requests.post(cfg['WORKER_ORIGIN'].rstrip('/')+'/auth/company/assertions',json={'assertion':assertion},timeout=(5,10),allow_redirects=False)
            if result.status_code!=200:raise ValueError()
            code=result.json()['code']
            if not re.fullmatch(r'[0-9a-f]{64}',code):raise ValueError()
        except Exception:
            session.clear();return '登入結果回報失敗，請返回網站重新登入。',502
        state=session['state'];session.clear()
        return redirect(cfg['APP_URL']+'#'+urlencode({'company_code':code,'state':state}),303)

    @app.get('/health')
    def health():return {'ok':True}
    return app
