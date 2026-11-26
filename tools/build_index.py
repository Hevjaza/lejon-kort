"""Merge set metadata into data/index.json + an honest FX snapshot (exchangerate-api.com open endpoint)."""
import json,os,time,urllib.request
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data')
def load(n):
    p=os.path.join(D,n); return json.load(open(p)) if os.path.exists(p) else []
fx=None
try:
    with urllib.request.urlopen('https://open.er-api.com/v6/latest/USD',timeout=20) as r: j=json.load(r)
    fx={'base':'USD','rates':{k:j['rates'][k] for k in ('USD','SEK','EUR','JPY')},'updated':j.get('time_last_update_utc'),'source':'exchangerate-api.com (open.er-api.com)'}
except Exception as e: print('fx fail',e)
op=load('onepiece_index.json')
for m in op:
    if m.get('apiId','').startswith('OP1') and '-EB' in m['apiId']:
        m['name']=m['name'].replace(m['apiId'],m['apiId'].replace('OP','OP-').replace('-EB','/EB-'),1)
op=[m for m in op if m.get('apiKind')!='deck'][::-1]+[m for m in op if m.get('apiKind')=='deck'][::-1]
sets=[]
for m in load('pokemon_index.json')+load('pokemon_ja_index.json')+op+load('sports_index.json'):
    sets.append({k:v for k,v in m.items() if v is not None})
idx={'generated':time.strftime('%Y-%m-%d %H:%M'),'fx':fx,'sets':sets}
json.dump(idx,open(os.path.join(D,'index.json'),'w'),ensure_ascii=False,separators=(',',':'))
print(len(sets),'sets', fx)
