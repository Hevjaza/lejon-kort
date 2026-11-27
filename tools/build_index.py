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
# bildstatus per set: hur många kort som har riktig bild + ett exempelkort (dyraste kortet med bild)
def pval(c):
    p=c.get('p') or {}
    return max([v for k,v in p.items() if isinstance(v,(int,float)) and (k.startswith('cm_t') or k.startswith('tp_') or k.startswith('usd_m'))] or [0])
for m in sets:
    f=os.path.join(D,'sets',m['id']+'.json')
    if not os.path.exists(f): continue
    cards=json.load(open(f))['cards']
    withimg=[c for c in cards if c.get('img') or c.get('imgf')]
    m['imgs']=len(withimg); m['ncards']=len(cards)
    if withimg:
        c=max(withimg,key=pval)
        m['sample']=c['imgf'] if c.get('imgf') else (c['img']+'/low.webp' if m['cat']=='pokemon' else c['img'])
idx={'generated':time.strftime('%Y-%m-%d %H:%M'),'fx':fx,'sets':sets}
json.dump(idx,open(os.path.join(D,'index.json'),'w'),ensure_ascii=False,separators=(',',':'))
print(len(sets),'sets', fx)
