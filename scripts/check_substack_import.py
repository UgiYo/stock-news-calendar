"""Read-only status check of the requested author's persisted import."""
import json
import os
from sync_substack import read_json

def main():
    data=read_json(os.environ['WORKER_API_URL'].rstrip('/')+'/admin/substack/authors',token=os.environ['COLLECTOR_SECRET'])
    author=next(a for a in data['authors'] if a['id']=='unclestocknotes')
    if author['article_count']<author['public_count'] or author['article_count']<0:raise ValueError('Invalid persisted counts')
    print('PERSISTED_SUBSTACK_STATE',json.dumps({k:author.get(k) for k in ['id','archive_offset','archive_complete','article_count','public_count','latest_published_at','updated_at','last_error']},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
