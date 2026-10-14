"""Import public Substack archive pages, with a durable cursor and no AI calls.

No cookies, credentials or paid-content access are used. Paid posts are previews.
"""
import datetime
import html.parser
import json
import os
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

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): raise ValueError('Unexpected source redirect')

def read_json(url, data=None, token=None):
    headers = {'User-Agent': 'StockNewsCalendar/1.0', 'Accept': 'application/json'}
    if token: headers['Authorization'] = 'Bearer ' + token
    if data is not None: headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, data=json.dumps(data, ensure_ascii=False).encode() if data is not None else None, headers=headers)
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=35) as response:
        limit = 1500000 if token else 12000000
        raw = response.read(limit + 1)
        if len(raw) > limit: raise ValueError('Source response too large')
        return json.loads(raw)

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

def sync_author(author, api, fetch=read_json, max_pages=10, deadline=None, clock=time.monotonic):
    def check_budget():
        if deadline is not None and clock() >= deadline: raise ImportBudgetExpired()
    def detail_row(post):
        check_budget()
        try: detail = fetch(author['url'] + '/api/v1/posts/' + urllib.parse.quote(str(post['slug']), safe='-'))
        except urllib.error.HTTPError as error:
            # A locked/deleted article must not block every older article. Keep
            # the archive title/date and only its public description as preview.
            if error.code not in (401, 403, 404): raise
            return article_row({**post, 'body_html': '', 'audience': 'only_paid'}, author)
        if not isinstance(detail, dict) or str(detail.get('slug')) != str(post['slug']): raise ValueError('Article source mismatch')
        return article_row(detail, author)
    # Collect new pages until the saved publication date. Commit oldest first:
    # a failed upload cannot advance the latest date past an unsaved newer page.
    latest = author.get('latest_published_at')
    if latest:
        latest = datetime.datetime.fromisoformat(latest.replace('Z', '+00:00'))
        batches = []; offset = 0; seen_pages = set()
        while True:
            check_budget()
            posts = fetch(author['url'] + '/api/v1/archive?sort=new&offset=' + str(offset) + '&limit=20')
            if not isinstance(posts, list): raise ValueError('Archive response is not a list')
            signature = tuple(str(p.get('slug', '')) for p in posts)
            if posts and signature in seen_pages: raise ValueError('Archive pagination did not advance')
            seen_pages.add(signature)
            new = [p for p in posts if datetime.datetime.fromisoformat(str(p['post_date']).replace('Z', '+00:00')) > latest]
            if new: batches.append([detail_row(p) for p in new])
            if len(new) < len(posts) or len(posts) < 20: break
            offset += len(posts)
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
                            'archive_offset': offset + len(posts), 'archive_complete': len(posts) < 20})
        page += 1
        if len(posts) < 20: return True
        offset += len(posts)
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
            sync_author(author, api, max_pages=None, deadline=deadline)
        except ImportBudgetExpired:
            print('Import time budget reached; saved pages will continue in the next workflow.'); break
        except Exception as error:
            message = str(error)[:400]; print(author['id'] + ': ' + message); errors.append(author['id'])
            api('/admin/substack/update', {'author_id': author['id'], 'error': '公開文章更新失敗：' + message})
    # Global workflow concurrency prevents overlapping writes. The next run
    # checks all authors again, so concurrent user requests cannot strand one.
    result = api('/admin/substack/continue', {})
    if result.get('continued'): print('Remaining historical archives queued for automatic continuation.')
    if errors: raise RuntimeError('Failed authors: ' + ', '.join(errors))

if __name__ == '__main__': main()
