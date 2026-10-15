import importlib.util
import pathlib
import unittest
import urllib.error
import io
import json
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('substack_sync', pathlib.Path(__file__).parents[1] / 'scripts/sync_substack.py')
sync = importlib.util.module_from_spec(spec); spec.loader.exec_module(sync)

def post(n, **extra):
    return dict(slug=f'post-{n}', title=f'Article {n}', post_date=f'2026-10-{min(28,n+1):02d}T12:00:00Z', audience='everyone', body_html='<p>NVIDIA 原文</p><script>bad()</script>', **extra)

class SubstackSyncTest(unittest.TestCase):
    def test_reader_preserves_original_json_and_never_forwards_credentials(self):
        url='https://example.substack.com/api/v1/archive?sort=new&offset=20&limit=20';calls=[]
        def opener(request,timeout):
            calls.append(request)
            return io.BytesIO(json.dumps({'code':200,'data':{'url':url,'text':json.dumps([post(0)])}}).encode())
        result=sync.read_reader_json(url,opener,pause=lambda _:None,clock=lambda:100)
        self.assertEqual(result,[post(0)])
        self.assertEqual(calls[0].full_url,'https://r.jina.ai/'+url)
        self.assertFalse(any(k.lower() in ('authorization','cookie') for k in calls[0].headers))
        self.assertEqual(calls[0].get_header('X-return-format'),'text')

    def test_reader_rejects_wrong_origin_invalid_json_and_fake_empty_archives(self):
        url='https://example.substack.com/api/v1/archive?offset=0&limit=20'
        for data in [{'url':'https://other.substack.com/api/v1/archive?offset=0&limit=20','text':'[]'}, {'url':url,'text':'<html>Challenge</html>'}, {'url':url,'text':'{}'}]:
            with self.assertRaises(ValueError):sync.read_reader_json(url,lambda *a,**k:io.BytesIO(json.dumps({'code':200,'data':data}).encode()),pause=lambda _:None,clock=lambda:100)
        post_url='https://example.substack.com/api/v1/posts/abc'
        with self.assertRaisesRegex(ValueError,'mismatch'):
            sync.read_reader_json(post_url,lambda *a,**k:io.BytesIO(json.dumps({'code':200,'data':{'url':post_url,'text':'{"slug":"other"}'}}).encode()),pause=lambda _:None,clock=lambda:100)

    def test_reader_rate_limit_waits_then_retries_and_uses_a_bounded_budget(self):
        url='https://example.substack.com/api/v1/archive';waits=[];calls=[]
        def opener(request,timeout):
            calls.append(request)
            if len(calls)<3:raise urllib.error.HTTPError(request.full_url,429,'Limited',{'Retry-After':'60'},None)
            return io.BytesIO(json.dumps({'code':200,'data':{'url':url,'text':'[]'}}).encode())
        self.assertEqual(sync.read_reader_json(url,opener,pause=waits.append,clock=lambda:100),[])
        self.assertEqual(len(calls),3);self.assertEqual(waits.count(60),2)

    def test_branch_continuation_dispatches_the_same_ref_without_sending_token_to_source(self):
        calls=[]
        class Response:
            status=204
            def __enter__(self):return self
            def __exit__(self,*args):pass
        def open_request(request,timeout):calls.append(request);return Response()
        with patch.dict(sync.os.environ,{'SUBSTACK_WORKFLOW_REF':'fix/substack-public-import-403','GITHUB_REPOSITORY':'UgiYo/stock-news-calendar','GITHUB_TOKEN':'fixture'}),patch.object(sync.urllib.request,'build_opener') as build:
            build.return_value.open.side_effect=open_request
            result=sync.continue_import(lambda path:{'authors':[{'archive_complete':0,'last_error':None}]})
        self.assertTrue(result['continued']);self.assertEqual(len(calls),1)
        self.assertEqual(calls[0].full_url,'https://api.github.com/repos/UgiYo/stock-news-calendar/actions/workflows/substack.yml/dispatches')
        self.assertEqual(json.loads(calls[0].data)['ref'],'fix/substack-public-import-403')

    def test_sitemap_supplement_saves_unlisted_post_before_marking_complete(self):
        author={'id':'example','url':'https://example.substack.com'};saved=[]
        def reader(url,**options):return '<a href="https://example.substack.com/p/post-0">known</a><a href="https://example.substack.com/p/post-1">hidden</a><a href="https://other.test/p/evil">ignored</a>'
        def api(path,data=None):
            if '/imported?' in path:return {'slugs':['post-0'],'has_more':False,'next_offset':1}
            saved.append(data)
        sync.finish_inventory(author,api,lambda url:post(1),reader=reader)
        self.assertEqual(saved[0]['articles'][0]['url'],author['url']+'/p/post-1')
        self.assertFalse(saved[0]['archive_complete']);self.assertTrue(saved[-1]['archive_complete'])
        self.assertEqual(saved[-1]['articles'],[])

    def test_sitemap_failure_or_pending_api_cannot_mark_full_import_complete(self):
        author={'id':'example','url':'https://example.substack.com'};saved=[]
        with self.assertRaisesRegex(ValueError,'publication links'):
            sync.finish_inventory(author,lambda *a:saved.append(a),lambda u:post(0),reader=lambda *a,**k:'<html>Unavailable</html>')
        self.assertEqual(saved,[])
        def unavailable(path,data=None):raise urllib.error.HTTPError(path,404,'Missing API',{},None)
        with self.assertRaisesRegex(RuntimeError,'新版後端'):
            sync.finish_inventory(author,unavailable,lambda u:post(0),reader=lambda *a,**k:'<a href="/p/post-0">post</a>')
        with self.assertRaisesRegex(ValueError,'有效文章清單'):
            sync.finish_inventory(author,lambda path:{'slugs':['post-0'],'has_more':False},lambda u:post(0),reader=lambda *a,**k:'<a href="/archive">archive</a>')

    def test_deferred_completion_stays_pending_until_inventory_validation(self):
        saved=[]
        def fetch(url):return [post(0)] if '/archive?' in url else post(0)
        author={'id':'example','url':'https://example.substack.com','archive_offset':0,'archive_complete':0}
        self.assertTrue(sync.sync_author(author,lambda path,data:saved.append(data),fetch,defer_complete=True))
        self.assertFalse(saved[-1]['archive_complete']);self.assertEqual(len(saved[-1]['articles']),1)

    def test_inventory_pause_preserves_saved_post_and_resumes_without_refetching_it(self):
        author={'id':'example','url':'https://example.substack.com'};saved=[];known=[];ticks=iter([0,0,0,2])
        def api(path,data=None):
            if '/imported?' in path:return {'slugs':known[:],'has_more':False,'next_offset':len(known)}
            saved.append(data)
            if data['articles']:known.append('post-0')
        reader=lambda *a,**k:'<a href="/p/post-0">post</a>'
        with patch.object(sync.time,'monotonic',side_effect=lambda:next(ticks)),self.assertRaises(sync.ImportBudgetExpired):
            sync.finish_inventory(author,api,lambda url:post(0),deadline=1,reader=reader)
        self.assertFalse(saved[-1]['archive_complete']);self.assertEqual(len(known),1)
        sync.finish_inventory(author,api,lambda url:self.fail('Saved body must not be fetched again'),reader=reader)
        self.assertTrue(saved[-1]['archive_complete'])

    def test_source_fallback_remembers_working_transport_and_blocked_details_do_not_complete(self):
        author={'id':'example','url':'https://example.substack.com'};calls=[]
        def direct(url):calls.append('direct');raise urllib.error.HTTPError(url,403,'Challenge',{},None)
        def api(path,data):calls.append('pages');raise urllib.error.HTTPError(path,502,'Bad Gateway',{},io.BytesIO(b'{"source_status":429,"error":"Limited"}'))
        def reader(url):calls.append('reader');return []
        fetch=sync.public_source(author,api,direct=direct,reader=reader)
        with patch.object(sync.time,'sleep'):
            self.assertEqual(fetch(author['url']+'/api/v1/archive'),[])
            self.assertEqual(fetch(author['url']+'/api/v1/archive?offset=20'),[])
        self.assertEqual(calls,['direct','pages','reader','reader'])
        def blocked(url):raise urllib.error.HTTPError(url,403,'Blocked',{},None)
        fetch=sync.public_source(author,api,direct=blocked,reader=blocked)
        with patch.object(sync.time,'sleep'),self.assertRaisesRegex(RuntimeError,'皆受阻'):fetch(author['url']+'/api/v1/posts/abc')

    def test_backend_source_maps_only_same_author_public_endpoints(self):
        author={'id':'example','url':'https://example.substack.com'};calls=[]
        def api(path,data):calls.append((path,data));return {'data':[]}
        fetch=sync.backend_source(author,api,pause=lambda _:None)
        self.assertEqual(fetch(author['url']+'/api/v1/archive?offset=40&limit=20'),[])
        self.assertEqual(calls[-1],('/admin/substack/source',{'author_id':'example','kind':'archive','offset':40}))
        fetch(author['url']+'/api/v1/posts/public-post')
        self.assertEqual(calls[-1][1],{'author_id':'example','kind':'post','slug':'public-post'})
        for bad in ['http://example.substack.com/api/v1/archive','https://other.substack.com/api/v1/archive','https://example.test/api/v1/archive','https://u:p@example.substack.com/api/v1/archive','https://example.substack.com/admin']:
            with self.assertRaises(ValueError):fetch(bad)
        self.assertEqual(len(calls),2)

    def test_backend_challenge_is_not_treated_as_a_paid_preview(self):
        import io,json
        author={'id':'example','url':'https://example.substack.com'}
        def api(path,data):raise urllib.error.HTTPError('https://api.test',502,'Bad Gateway',{},io.BytesIO(json.dumps({'blocked':True,'source_status':403,'error':'來源要求瀏覽器驗證'}).encode()))
        with self.assertRaisesRegex(RuntimeError,'瀏覽器驗證'):sync.backend_source(author,api,pause=lambda _:None)(author['url']+'/api/v1/posts/public-post')
        def locked(path,data):raise urllib.error.HTTPError('https://api.test',502,'Bad Gateway',{},io.BytesIO(b'{"source_status":403,"error":"Restricted post"}'))
        with self.assertRaises(urllib.error.HTTPError) as result:sync.backend_source(author,locked,pause=lambda _:None)(author['url']+'/api/v1/posts/public-post')
        self.assertEqual(result.exception.code,403)

    def test_archive_forbidden_retains_cursor_and_does_not_mark_complete(self):
        saved=[];author={'id':'example','url':'https://example.substack.com','archive_offset':40,'archive_complete':0}
        def fetch(url):raise urllib.error.HTTPError(url,403,'Forbidden',{},None)
        with self.assertRaises(urllib.error.HTTPError):sync.sync_author(author,lambda *args:saved.append(args),fetch)
        self.assertEqual(saved,[]);self.assertEqual(author['archive_offset'],40);self.assertEqual(author['archive_complete'],0)

    def test_plain_text_and_paid_preview(self):
        a = sync.article_row({**post(0), 'audience': 'only_paid'}, {'url': 'https://example.substack.com'})
        self.assertEqual(a['access'], 'preview'); self.assertNotIn('bad', a['text']); self.assertIn('NVIDIA', a['text'])

    def test_history_resume_preserves_every_post_and_final_short_page(self):
        posts = [post(n) for n in range(45)]; uploaded = []
        def fetch(url):
            if '/archive?' in url:
                offset = int(url.split('offset=')[1].split('&')[0]); return posts[offset:offset+20]
            return posts[int(url.rsplit('-',1)[1])]
        author = {'id':'example','url':'https://example.substack.com','archive_offset':40,'archive_complete':0}
        sync.sync_author(author, lambda path,data: uploaded.append(data), fetch)
        self.assertEqual(len(uploaded), 2); self.assertEqual(uploaded[-1]['archive_offset'],45); self.assertTrue(uploaded[-1]['archive_complete'])
        self.assertEqual(len({a['url'] for batch in uploaded for a in batch['articles']}),25)

    def test_reader_overlap_keeps_every_article_and_fetches_each_body_once(self):
        posts=[post(n) for n in range(45)];saved=[];bodies=[]
        def fetch(url):
            if '/archive?' in url:
                offset=int(url.split('offset=')[1].split('&')[0]);return posts[offset:offset+20]
            n=int(url.rsplit('-',1)[1]);bodies.append(n);return posts[n]
        fetch.transport='reader'
        author={'id':'example','url':'https://example.substack.com','archive_offset':0,'archive_complete':0}
        self.assertTrue(sync.sync_author(author,lambda path,data:saved.append(data),fetch,max_pages=None))
        self.assertEqual(len(saved),4);self.assertEqual(saved[-1]['archive_offset'],45)
        self.assertEqual(len({a['url'] for b in saved for a in b['articles']}),45)
        self.assertEqual(sorted(bodies),list(range(45)))

    def test_more_than_one_page_of_new_posts_and_oldest_first_checkpoint(self):
        posts = sorted([post(n) for n in range(26)], key=lambda p:p['post_date'], reverse=True); uploaded = []
        def fetch(url):
            if '/archive?' in url:
                offset = int(url.split('offset=')[1].split('&')[0]); return posts[offset:offset+20]
            return next(p for p in posts if p['slug'] == url.rsplit('/',1)[1])
        author={'id':'example','url':'https://example.substack.com','archive_offset':100,'archive_complete':1,'latest_published_at':'2026-10-01T12:00:00Z'}
        sync.sync_author(author, lambda path,data: uploaded.append(data), fetch)
        self.assertEqual(sum(len(b['articles']) for b in uploaded),25)
        self.assertLess(max(a['published_at'] for a in uploaded[0]['articles']),min(a['published_at'] for a in uploaded[1]['articles']))
        self.assertNotIn('archive_offset',uploaded[0])

    def test_source_error_does_not_commit_partial_page(self):
        uploaded=[]
        def fetch(url):
            if '/archive?' in url:return [post(0),post(1)]
            if url.endswith('post-1'):raise ValueError('Unavailable')
            return post(0)
        author={'id':'example','url':'https://example.substack.com','archive_offset':0,'archive_complete':0}
        with self.assertRaises(ValueError): sync.sync_author(author,lambda path,data:uploaded.append(data),fetch)
        self.assertEqual(uploaded,[])

    def test_utf8_batches_checkpoint_only_after_last_upload(self):
        uploaded=[];rows=[{**sync.article_row(post(n),{'url':'https://example.substack.com'}),'text':'中'*100000} for n in range(3)]
        sync.upload_update(lambda path,data:uploaded.append(data),{'author_id':'example','articles':rows,'archive_offset':3,'archive_complete':True})
        self.assertEqual(len(uploaded),3);self.assertTrue(all('archive_offset' not in b for b in uploaded[:-1]));self.assertEqual(uploaded[-1]['archive_offset'],3)

    def test_large_public_article_is_marked_partial_and_cannot_block_history(self):
        row=sync.article_row({**post(0),'body_html':'<p>'+'中'*100001+'</p>'},{'url':'https://example.substack.com'})
        self.assertEqual(len(row['text']),100000);self.assertEqual(row['access'],'preview')

    def test_full_import_goes_past_200_posts_and_reads_final_page(self):
        posts=[post(n) for n in range(225)];saved=[]
        def fetch(url):
            if '/archive?' in url:
                offset=int(url.split('offset=')[1].split('&')[0]);return posts[offset:offset+20]
            return posts[int(url.rsplit('-',1)[1])]
        author={'id':'example','url':'https://example.substack.com','archive_offset':0,'archive_complete':0}
        self.assertTrue(sync.sync_author(author,lambda path,data:saved.append(data),fetch,max_pages=None))
        self.assertEqual(saved[-1]['archive_offset'],225);self.assertTrue(saved[-1]['archive_complete']);self.assertEqual(len({a['url'] for batch in saved for a in batch['articles']}),225)

    def test_time_budget_preserves_page_cursor_and_resume_finishes(self):
        posts=[post(n) for n in range(45)];saved=[];ticks=iter([0]*21+[2])
        def fetch(url):
            if '/archive?' in url:
                offset=int(url.split('offset=')[1].split('&')[0]);return posts[offset:offset+20]
            return posts[int(url.rsplit('-',1)[1])]
        author={'id':'example','url':'https://example.substack.com','archive_offset':0,'archive_complete':0}
        with self.assertRaises(sync.ImportBudgetExpired):sync.sync_author(author,lambda path,data:saved.append(data),fetch,max_pages=None,deadline=1,clock=lambda:next(ticks))
        self.assertEqual(saved[-1]['archive_offset'],20);self.assertFalse(saved[-1]['archive_complete'])
        author['archive_offset']=20;self.assertTrue(sync.sync_author(author,lambda path,data:saved.append(data),fetch,max_pages=None));self.assertEqual(saved[-1]['archive_offset'],45)
        self.assertEqual(len({a['url'] for batch in saved for a in batch['articles']}),45)

    def test_locked_article_retains_preview_and_does_not_block_older_posts(self):
        saved=[]
        def fetch(url):
            if '/archive?' in url:return [{**post(0),'subtitle':'公開說明'},post(1)]
            if url.endswith('post-0'):raise urllib.error.HTTPError(url,403,'Paid',{},None)
            return post(1)
        author={'id':'example','url':'https://example.substack.com','archive_offset':0,'archive_complete':0}
        self.assertTrue(sync.sync_author(author,lambda path,data:saved.append(data),fetch,max_pages=None))
        self.assertEqual(len(saved[-1]['articles']),2);self.assertEqual(saved[-1]['articles'][0]['access'],'preview');self.assertEqual(saved[-1]['articles'][0]['text'],'公開說明')
        self.assertTrue(saved[-1]['archive_complete'])

    def test_stalled_archive_pagination_stops_after_saved_page(self):
        saved=[];posts=[post(n) for n in range(20)]
        def fetch(url):
            if '/archive?' in url:return posts
            return posts[int(url.rsplit('-',1)[1])]
        author={'id':'example','url':'https://example.substack.com','archive_offset':0,'archive_complete':0}
        with self.assertRaisesRegex(ValueError,'did not advance'):sync.sync_author(author,lambda path,data:saved.append(data),fetch,max_pages=None)
        self.assertEqual(len(saved),1);self.assertEqual(saved[0]['archive_offset'],20)

    def test_workflow_pause_automatically_queues_remaining_archives(self):
        calls=[];authors=[{'id':'first','archive_complete':0},{'id':'priority','archive_complete':0}]
        def api(url,data=None,token=None):
            calls.append((url,data))
            return {'authors':authors} if url.endswith('/authors') else {'continued':True}
        with patch.dict(sync.os.environ,{'WORKER_API_URL':'https://api.test','COLLECTOR_SECRET':'fixture','SUBSTACK_AUTHOR_ID':'priority','SUBSTACK_CONTINUATION':'false'}),patch.object(sync,'read_json',side_effect=api),patch.object(sync,'sync_author',side_effect=sync.ImportBudgetExpired()) as importer:
            sync.main()
            self.assertEqual(importer.call_args.args[0]['id'],'priority');self.assertIsNone(importer.call_args.kwargs['max_pages'])
        self.assertEqual(calls[-1],('https://api.test/admin/substack/continue',{}))

if __name__ == '__main__': unittest.main()
