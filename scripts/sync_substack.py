"""Import public Substack archive pages, with a durable cursor and no AI calls.

No cookies, credentials or paid-content access are used. Paid posts are previews.
"""
import datetime
import html.parser
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

class ArticleText(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(); self.parts = []; self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'button', 'noscript'): self.skip += 1
        if not self.skip and tag in ('p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'blockquote', 'tr'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'button', 'noscript'): self.skip = max(0, self.skip - 1)
        if not self.skip and tag in ('p', 'div', 'li', 'blockquote', 'tr'): self.parts.append('\n')
    def handle_data(self, text):
        if not self.skip: self.parts.append(text)
    def text(self):
        return '\n'.join(' '.join(line.split()) for line in ''.join(self.parts).splitlines() if line.strip())

def article_row(post, author):
    slug = str(post.get('slug', ''))
    if not slug or '/' in slug or '?' in slug or '#' in slug: raise ValueError('Invalid article slug')
    date = post.get('post_date') or post.get('published_at')
    datetime.datetime.fromisoformat(str(date).replace('Z', '+00:00'))
    parser = ArticleText(); parser.feed(post.get('body_html') or post.get('description') or post.get('subtitle') or '')
    text = parser.text()
    return {'url': author['url'] + '/p/' + urllib.parse.quote(slug, safe='-'), 'title': str(post.get('title') or slug), 'published_at': date, 'text': text[:100000],
            'access': 'public' if len(text) <= 100000 and post.get('audience') == 'everyone' and post.get('body_html') and not post.get('is_paid') else 'preview'}

class SourceRedirectError(ValueError): pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): raise SourceRedirectError('Unexpected source redirect')

def read_json(url, data=None, token=None):
    if token is None and data is None:
        return read_public_json(url)
    headers = {'User-Agent': 'StockNewsCalendar/1.0', 'Accept': 'application/json'}
    if token: headers['Authorization'] = 'Bearer ' + token
    if data is not None: headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, data=json.dumps(data, ensure_ascii=False).encode() if data is not None else None, headers=headers)
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=150 if urllib.parse.urlsplit(url).path == '/admin/substack/source' else 35) as response:
        limit = 12000000 if urllib.parse.urlsplit(url).path == '/admin/substack/source' else 1500000
        raw = response.read(limit + 1)
        if len(raw) > limit: raise ValueError('Source response too large')
        return json.loads(raw)

def public_endpoint(url, sitemap=False):
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port
            or not re.fullmatch(r'[a-z0-9][a-z0-9-]*\.substack\.com', parsed.hostname or '')
            or not (parsed.path == '/api/v1/archive' or re.fullmatch(r'/api/v1/posts/[^/]+', parsed.path)
                    or sitemap and re.fullmatch(r'/sitemap(?:[/.-][a-zA-Z0-9_-]+)*\.xml',parsed.path))):
        raise ValueError('Invalid public Substack endpoint')
    return parsed

def read_public_json(url):
    public_endpoint(url)
    request = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0 (compatible; StockNewsCalendar/1.0)', 'Accept':'application/json'})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=35) as response:
        raw = response.read(12000001)
        if len(raw) > 12000000: raise ValueError('Source response too large')
        return json.loads(raw)

def backend_source(author, api, pause=time.sleep):
    """Fetch from existing Pages egress, not the blocked GitHub runner network."""
    def fetch(url):
        parsed = public_endpoint(url)
        if 'https://' + parsed.netloc != author['url']: raise ValueError('Article source mismatch')
        query = urllib.parse.parse_qs(parsed.query)
        data = {'author_id':author['id'], 'kind':'archive' if parsed.path == '/api/v1/archive' else 'post'}
        if data['kind'] == 'archive': data['offset'] = int(query.get('offset',['0'])[0])
        else: data['slug'] = urllib.parse.unquote(parsed.path.rsplit('/',1)[1])
        pause(1)  # Keep bulk historical imports below one source request/second.
        try: return api('/admin/substack/source',data)['data']
        except urllib.error.HTTPError as error:
            try: failure = json.loads(error.read(12000))
            except (ValueError, AttributeError): raise error
            if failure.get('blocked'): raise RuntimeError(failure['error']) from error
            raise urllib.error.HTTPError(url, failure.get('source_status',error.code), failure.get('error','公開來源讀取失敗'),{},None) from error
    return fetch

_reader_started = 0.0
def read_reader_json(url, opener=None, pause=time.sleep, clock=time.monotonic, format='text'):
    """Fetch original anonymous JSON through Reader; never send account secrets.

    Use text extraction, not AI conversion. Validate the returned source URL and
    JSON shape rather than treating a reader error page as an empty archive.
    """
    global _reader_started
    expected = public_endpoint(url,sitemap=format=='html')
    page_limit = int(urllib.parse.parse_qs(expected.query).get('limit',['20'])[0])
    if not 1 <= page_limit <= 50: raise ValueError('Invalid reader page limit')
    if opener is None: opener = urllib.request.build_opener(NoRedirect()).open
    for attempt in range(3):
        pause(max(0, 4.1 - (clock() - _reader_started)))
        _reader_started = clock()
        request = urllib.request.Request('https://r.jina.ai/' + url, headers={
            'User-Agent':'StockNewsCalendar/1.0', 'Accept':'application/json',
            'X-Return-Format':format, 'X-Cache-Tolerance':'60'})
        try:
            with opener(request, timeout=80) as response:
                raw = response.read(12000001)
                if len(raw) > 12000000: raise ValueError('Reader response too large')
                envelope = json.loads(raw)
            if envelope.get('code') != 200 or not isinstance(envelope.get('data'), dict):
                raise ValueError('Reader did not return original source data')
            data = envelope['data']; actual = public_endpoint(data.get('url',''),sitemap=format=='html')
            if ((actual.scheme,actual.netloc,actual.path,sorted(urllib.parse.parse_qsl(actual.query))) !=
                    (expected.scheme,expected.netloc,expected.path,sorted(urllib.parse.parse_qsl(expected.query)))):
                raise ValueError('Reader source URL mismatch')
            if format=='html':
                if not isinstance(data.get('html'),str): raise ValueError('Missing sitemap HTML')
                return data['html']
            result = json.loads(data.get('text') or data.get('content') or '')
            if expected.path == '/api/v1/archive':
                if not isinstance(result,list) or len(result)>page_limit: raise ValueError('Invalid reader archive')
            elif not isinstance(result,dict) or str(result.get('slug')) != urllib.parse.unquote(expected.path.rsplit('/',1)[1]):
                raise ValueError('Reader article source mismatch')
            return result
        except urllib.error.HTTPError as error:
            if error.code not in (429,500,502,503,504) or attempt == 2: raise
            retry = error.headers.get('Retry-After','') if error.headers else ''
            seconds = int(retry) if retry.isdigit() else 15 * (attempt + 1)
            pause(min(120,max(5,seconds)))

def public_source(author, api=None, direct=read_public_json, reader=read_reader_json):
    """Select a working transport once per publication, retaining page semantics."""
    methods = [('direct',direct)] + ([('pages',backend_source(author,api))] if api else []) + [('reader',reader)]
    selected = None; unavailable = set()
    def fetch(url):
        nonlocal selected
        parsed = public_endpoint(url)
        if 'https://' + parsed.netloc != author['url']: raise ValueError('Article source mismatch')
        choices = sorted(methods,key=lambda item:item[0] != selected) if selected else methods
        last = None
        for name, method in choices:
            if name in unavailable: continue
            try:
                result = method(url)
                if selected != name: print('Public source transport selected:',name,flush=True)
                selected = name
                fetch.transport = name
                return result
            except urllib.error.HTTPError as error:
                if error.code not in (403,408,429,500,502,503,504) and not (name=='pages' and error.code==404): raise
                last = error
            except (urllib.error.URLError,TimeoutError,json.JSONDecodeError,RuntimeError,SourceRedirectError) as error:
                last = error
            unavailable.add(name)
            print('Public source transport unavailable:',name,type(last).__name__,flush=True)
        if last is None: raise RuntimeError('No public source transport available')
        if isinstance(last,urllib.error.HTTPError) and last.code == 403:
            raise RuntimeError('公開來源連線皆受阻，已保留匯入進度') from last
        raise last
    return fetch

def continue_import(api):
    # Verification branches must resume their own tested code, never dispatch
    # main's older importer. Production still uses the existing backend route.
    ref = os.environ.get('SUBSTACK_WORKFLOW_REF','main')
    if ref == 'main': return api('/admin/substack/continue',{})
    if not any(not a['archive_complete'] and not a.get('last_error') for a in api('/admin/substack/authors')['authors']):
        return {'continued':False}
    repo = os.environ['GITHUB_REPOSITORY']; token = os.environ['GITHUB_TOKEN']
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',repo) or not re.fullmatch(r'[A-Za-z0-9_./-]+',ref):
        raise ValueError('Invalid continuation repository or ref')
    request=urllib.request.Request('https://api.github.com/repos/'+repo+'/actions/workflows/substack.yml/dispatches',
        data=json.dumps({'ref':ref,'inputs':{'author_id':'','continuation':True}}).encode(),
        headers={'Authorization':'Bearer '+token,'User-Agent':'StockNewsCalendar/1.0','Accept':'application/vnd.github+json','Content-Type':'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request,timeout=25) as response:
            if response.status != 204: raise RuntimeError('Continuation dispatch failed')
    except urllib.error.HTTPError as error:
        if error.code not in (404,422):raise
        # A merged PR's branch may be deleted while the last import is running.
        return api('/admin/substack/continue',{})
    return {'continued':True}

def sitemap_slugs(author, check_budget=lambda:None, reader=read_reader_json):
    class Links(html.parser.HTMLParser):
        def __init__(self):super().__init__();self.links=[]
        def handle_starttag(self,tag,attrs):
            if tag=='a':self.links.append(dict(attrs).get('href',''))
    pending=[author['url']+'/sitemap.xml'];visited=set();slugs=set();valid_links=0
    while pending:
        check_budget();url=pending.pop()
        if url in visited:continue
        if len(visited)>=50:raise ValueError('Sitemap index exceeds import limit')
        visited.add(url);parser=Links();parser.feed(reader(url,format='html'))
        for href in parser.links:
            u=urllib.parse.urlsplit(urllib.parse.urljoin(url,href))
            if u.scheme+'://'+u.netloc!=author['url'] or u.query or u.fragment:continue
            valid_links+=1
            if u.path.startswith('/p/'):
                slug=urllib.parse.unquote(u.path[3:].rstrip('/'))
                if not slug or '/' in slug or '?' in slug or '#' in slug:raise ValueError('Invalid sitemap article')
                slugs.add(slug)
            elif re.fullmatch(r'/sitemap(?:[/.-][a-zA-Z0-9_-]+)*\.xml',u.path):pending.append(u.geturl())
    if not valid_links:raise ValueError('Sitemap did not contain publication links')
    return slugs

def finish_inventory(author, api, fetch, deadline=None, reader=read_reader_json):
    def check_budget():
        if deadline is not None and time.monotonic()>=deadline:raise ImportBudgetExpired()
    expected=sitemap_slugs(author,check_budget,reader);known=set();offset=0
    try:
        while True:
            check_budget()
            page=api('/admin/substack/imported?author_id='+urllib.parse.quote(author['id'])+'&offset='+str(offset))
            known.update(urllib.parse.unquote(s) for s in page['slugs'])
            if not page['has_more']:break
            if page['next_offset']<=offset:raise ValueError('Stored article pagination did not advance')
            offset=page['next_offset']
    except urllib.error.HTTPError as error:
        if error.code!=404:raise
        raise RuntimeError('文章已保存，請完成新版後端部署後再執行 sitemap 完整性校驗') from error
    if known and not expected:raise ValueError('已存文章仍存在，但 sitemap 未提供有效文章清單')
    missing=sorted(expected-known)
    print('Sitemap inventory:',len(expected),'links;',len(missing),'articles to save',flush=True)
    for slug in missing:
        check_budget();post=fetch(author['url']+'/api/v1/posts/'+urllib.parse.quote(slug,safe='-'))
        if post.get('slug')!=slug:raise ValueError('Sitemap article source mismatch')
        upload_update(api,{'author_id':author['id'],'articles':[article_row(post,author)],'archive_complete':False})
    check_budget();upload_update(api,{'author_id':author['id'],'articles':[],'archive_complete':True})
    print('Verified and saved complete public inventory:',author['id'],len(expected),'sitemap articles',flush=True)

def upload_update(api, data):
    # Bound UTF-8 upload size, not character count. Advance the archive cursor
    # only on the last successfully saved chunk; retries upsert earlier chunks.
    rows = data['articles']; batch = []; size = 0
    for row in rows:
        count = len(json.dumps(row, ensure_ascii=False).encode())
        if batch and size + count > 500000:
            api('/admin/substack/update', {'author_id': data['author_id'], 'articles': batch})
            batch = []; size = 0
        batch.append(row); size += count
    api('/admin/substack/update', {**data, 'articles': batch})

class ImportBudgetExpired(Exception):
    """A clean pause; saved pages will be resumed by the next workflow."""

def sync_author(author, api, fetch=read_json, max_pages=10, deadline=None, clock=time.monotonic, defer_complete=False):
    details = {}
    def check_budget():
        if deadline is not None and clock() >= deadline: raise ImportBudgetExpired()
    def detail_row(post):
        check_budget()
        if post['slug'] in details: return details[post['slug']]
        try: detail = fetch(author['url'] + '/api/v1/posts/' + urllib.parse.quote(str(post['slug']), safe='-'))
        except urllib.error.HTTPError as error:
            # A locked/deleted article must not block every older article. Keep
            # the archive title/date and only its public description as preview.
            if error.code not in (401, 403, 404): raise
            row=article_row({**post, 'body_html': '', 'audience': 'only_paid'}, author)
            details[post['slug']]=row
            return row
        if not isinstance(detail, dict) or str(detail.get('slug')) != str(post['slug']): raise ValueError('Article source mismatch')
        row=article_row(detail, author);details[post['slug']]=row
        return row
    def advance(posts):
        # Reader caches each URL separately; overlap half a page so small
        # publication changes or differing cache ages cannot skip boundary rows.
        return min(10,len(posts)) if getattr(fetch,'transport',None)=='reader' else len(posts)
    # Collect new pages until the saved publication date. Commit oldest first:
    # a failed upload cannot advance the latest date past an unsaved newer page.
    latest = author.get('latest_published_at')
    if latest:
        latest = datetime.datetime.fromisoformat(latest.replace('Z', '+00:00'))
        batches = []; offset = 0; seen_pages = set();seen_new=set()
        while True:
            check_budget()
            posts = fetch(author['url'] + '/api/v1/archive?sort=new&offset=' + str(offset) + '&limit=20')
            if not isinstance(posts, list): raise ValueError('Archive response is not a list')
            signature = tuple(str(p.get('slug', '')) for p in posts)
            if posts and signature in seen_pages: raise ValueError('Archive pagination did not advance')
            seen_pages.add(signature)
            new = [p for p in posts if datetime.datetime.fromisoformat(str(p['post_date']).replace('Z', '+00:00')) > latest]
            fresh=[p for p in new if p['slug'] not in seen_new];seen_new.update(p['slug'] for p in fresh)
            if fresh: batches.append([detail_row(p) for p in fresh])
            if len(new) < len(posts) or len(posts) < 20: break
            offset += advance(posts)
        for rows in reversed(batches): upload_update(api, {'author_id': author['id'], 'articles': sorted(rows, key=lambda r:r['published_at'])})
    if author['archive_complete']: return True
    # Resume historical pages, overlapping one page to absorb archive shifts.
    offset = max(0, author['archive_offset'] - 20)
    page = 0; seen_pages = set()
    while max_pages is None or page < max_pages:
        check_budget()
        posts = fetch(author['url'] + '/api/v1/archive?sort=new&offset=' + str(offset) + '&limit=20')
        if not isinstance(posts, list): raise ValueError('Archive response is not a list')
        if posts and any(not p.get('slug') for p in posts): raise ValueError('Archive response missing article slugs')
        signature = tuple(str(p['slug']) for p in posts)
        if posts and signature in seen_pages: raise ValueError('Archive pagination did not advance')
        seen_pages.add(signature)
        rows = []
        for post in posts:
            # Archive lists may omit bodies; use only anonymously accessible detail.
            rows.append(detail_row(post))
        upload_update(api, {'author_id': author['id'], 'articles': rows,
                            'archive_offset': offset + len(posts), 'archive_complete': len(posts) < 20 and not defer_complete})
        print('Saved historical archive checkpoint:',author['id'],offset+len(posts),'complete='+str(len(posts)<20 and not defer_complete),flush=True)
        page += 1
        if len(posts) < 20: return True
        offset += advance(posts)
    return False

def main():
    base = os.environ['WORKER_API_URL'].rstrip('/'); token = os.environ['COLLECTOR_SECRET']
    def api(path, data=None): return read_json(base + path, data, token)
    errors = []; priority = os.environ.get('SUBSTACK_AUTHOR_ID', ''); continuation = os.environ.get('SUBSTACK_CONTINUATION') == 'true'
    deadline = time.monotonic() + 20 * 60
    authors = api('/admin/substack/authors')['authors']
    authors.sort(key=lambda a:(a['id'] != priority, bool(a['archive_complete']), a['id']))
    for author in authors:
        if continuation and author.get('last_error'): continue
        try:
            source=public_source(author,api)
            if sync_author(author,api,fetch=source,max_pages=None,deadline=deadline,defer_complete=True):
                finish_inventory(author,api,source,deadline)
        except ImportBudgetExpired:
            print('Import time budget reached; saved pages will continue in the next workflow.'); break
        except Exception as error:
            message = str(error)[:400]; print(author['id'] + ': ' + message); errors.append(author['id'])
            api('/admin/substack/update', {'author_id': author['id'], 'error': '公開文章更新失敗：' + message})
    # Global workflow concurrency prevents overlapping writes. The next run
    # checks all authors again, so concurrent user requests cannot strand one.
    result = continue_import(api)
    if result.get('continued'): print('Remaining historical archives queued for automatic continuation.')
    if errors: raise RuntimeError('Failed authors: ' + ', '.join(errors))

if __name__ == '__main__': main()
