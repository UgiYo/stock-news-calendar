"""Snapshot official TPEx value-chain memberships, preserving last good file on failure."""
import concurrent.futures, datetime, html, json, pathlib, re, urllib.request
BASE='https://ic.tpex.org.tw/introduce.php?ic='

def fetch(code):
    req=urllib.request.Request(BASE+code,headers={'User-Agent':'Mozilla/5.0'})
    with urllib.request.urlopen(req,timeout=40) as r:return r.read().decode('utf-8')

def parse(text,parent,parent_name):
    parts=re.split(r'<div\s+id="companyList_([^\"]+)"\s+title="([^\"]+)"[^>]*>',text)
    stages={};stage=''
    for match in re.finditer(r'<div[^>]*class="chain-title-panel"[^>]*>(.*?)</div>|id="ic_link_([^"]+)"',text,re.S):
        if match.group(1) is not None:stage=html.unescape(re.sub('<[^>]+>','',match.group(1))).strip()
        else:stages[match.group(2)]=stage
    groups={}
    for i in range(1,len(parts),3):
        key,name,body=parts[i:i+3]
        codes=sorted(set(re.findall(r'company_basic\.php\?stk_code=(\d{4})(?:["&])',body)))
        if codes:groups[parent+':'+key]={'id':parent+':'+key,'industry':parent_name,'name':((stages.get(key)+'／') if stages.get(key) else '')+html.unescape(name),'codes':codes,'source':BASE+parent}
    return list(groups.values())

def main():
    first=fetch('D000')
    select=re.search(r'<select id="ic_option".*?</select>',first,re.S).group()
    parents=re.findall(r"<option value='([^']+)'[^>]*>([^<]+)</option>",select)
    groups=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures={pool.submit(fetch,code):(code,name) for code,name in parents}
        for future in concurrent.futures.as_completed(futures):
            code,name=futures[future];items=parse(future.result(),code,name)
            if not items:raise RuntimeError('Empty official classification: '+code)
            groups.extend(items)
    result={'source':'櫃買中心產業價值鏈資訊平台','updated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'industries':len(parents),'groups':sorted(groups,key=lambda g:g['id'])}
    path=pathlib.Path(__file__).resolve().parents[1]/'public/data/value-chains.json'
    path.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
    print('Official value chains:',len(parents),'industries,',len(groups),'segments')
if __name__=='__main__':main()
