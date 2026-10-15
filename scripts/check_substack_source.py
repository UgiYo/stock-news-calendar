"""Read-only verification of the importer source transport; no credentials or writes."""
import json
import os
import urllib.parse

def main():
    from sync_substack import public_source,article_row
    author={'id':'unclestocknotes','url':'https://unclestocknotes.substack.com'}
    fetch=public_source(author)
    pages=[fetch(author['url']+'/api/v1/archive?sort=new&offset='+str(offset)+'&limit=20') for offset in (0,10)]
    seen=set();signatures=set()
    for page in pages:
        if not isinstance(page,list) or len(page)!=20: raise ValueError('Missing archive page')
        for post in page:
            seen.add(post['slug'])
    public=fetch(author['url']+'/api/v1/posts/happy-new-year')
    row=article_row(public,author)
    if row['access']!='public' or len(row['text'])<100: raise ValueError('Missing older public body')
    paid=next(p for p in pages[0] if p.get('audience')=='only_paid')
    preview=article_row(fetch(author['url']+'/api/v1/posts/'+paid['slug']),author)
    if preview['access']!='preview': raise ValueError('Paid content was incorrectly marked public')
    print('Public source verified:',json.dumps({'pages':[len(p) for p in pages],'older_public_chars':len(row['text']),'paid_preview_chars':len(preview['text'])}),flush=True)
    if os.environ.get('SUBSTACK_FULL_HISTORY')=='true':
        offset=20
        while True:
            page=fetch(author['url']+'/api/v1/archive?sort=new&offset='+str(offset)+'&limit=50')
            signature=tuple(p['slug'] for p in page)
            if page and signature in signatures: raise ValueError('Historical pagination repeated')
            signatures.add(signature)
            for post in page: seen.add(post['slug'])
            end=offset+len(page)
            print('Verified archive entries:',end,'unique:',len(seen),flush=True)
            if len(page)<50: break
            offset+=25
        if len(seen)<200 or 'happy-new-year' not in seen: raise ValueError('Historical archive incomplete')
        from sync_substack import sitemap_slugs
        links=sitemap_slugs(author)
        missing=links-seen
        print('Sitemap cross-check:',len(links),'published links;',len(missing),'sitemap-only articles',flush=True)
        for slug in sorted(missing):
            detail=fetch(author['url']+'/api/v1/posts/'+urllib.parse.quote(slug,safe='-'))
            validated=article_row(detail,author)
            if not validated['title'] or not validated['published_at']:raise ValueError('Invalid sitemap article')
            seen.add(slug)
            print('Verified sitemap-only article:',slug,'audience:',detail.get('audience'),flush=True)
        if not links or links-seen:raise ValueError('Historical inventory incomplete')
        print('FULL HISTORICAL ARCHIVE VERIFIED:' ,len(seen),'unique articles; no writes or AI calls',flush=True)

if __name__ == '__main__': main()
