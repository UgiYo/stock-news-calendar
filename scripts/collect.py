import json,os,urllib.request,urllib.error,time,sys
base=os.environ['SUPABASE_URL'].rstrip('/')
key=os.environ['SUPABASE_SERVICE_ROLE_KEY']
# Paginate: Supabase returns at most 1000 rows by default.
codes=set();offset=0
while True:
 req=urllib.request.Request(base+'/rest/v1/watchlists?select=company_code&order=user_id,company_code&limit=1000&offset='+str(offset),headers={'apikey':key,'Authorization':'Bearer '+key})
 with urllib.request.urlopen(req,timeout=60) as r:rows=json.load(r)
 codes.update(w['company_code'] for w in rows)
 if len(rows)<1000:break
 offset+=1000
failed=[]
for code in sorted(codes):
 for attempt in range(3):
  try:
   req=urllib.request.Request(base+'/functions/v1/collect',data=json.dumps({'code':code}).encode(),headers={'Content-Type':'application/json','x-collector-secret':os.environ['COLLECTOR_SECRET'],'apikey':os.environ['SUPABASE_ANON_KEY']})
   with urllib.request.urlopen(req,timeout=170) as r:result=json.load(r)
   if result.get('errors'):raise RuntimeError('來源更新失敗')
   print(code,json.dumps(result,ensure_ascii=False));break
  except Exception as e:
   if attempt==2:failed.append(code);print(code,'failed',type(e).__name__)
   else:time.sleep(5*(attempt+1))
if failed:print('Failed:',','.join(failed));sys.exit(1)
