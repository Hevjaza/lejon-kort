"""Bundle real One Piece TCG sets (English) + market prices (USD) from optcgapi.com."""
import json,os,time,urllib.request,re
OUT=os.path.join(os.path.dirname(__file__),'..','data','sets'); os.makedirs(OUT,exist_ok=True)
def get(u,tries=4,to=60):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'LejonKort/1.0'}),timeout=to) as r: return json.load(r)
        except Exception as e:
            if i==tries-1: raise
            time.sleep(3*(i+1))
def r2(x): return round(x,2) if isinstance(x,(int,float)) and x>0 else None
def conv(rows):
    cards=[]; seen=set()
    for x in rows:
        cid=x.get('card_image_id') or x.get('card_set_id')
        if cid in seen: continue
        seen.add(cid)
        d={'id':'op-'+cid,'n':cid,'base':x.get('card_set_id'),'name':x.get('card_name'),'r':x.get('rarity'),'col':x.get('card_color'),'type':x.get('card_type'),'v':['normal']}
        if x.get('card_image'): d['img']=x['card_image']
        mp=r2(x.get('market_price')); ip=r2(x.get('inventory_price'))
        if mp or ip: d['p']={k:v for k,v in (('usd_m',mp),('usd_l',ip),('d',x.get('date_scraped'))) if v}
        if '_p' in cid or re.search(r'\((Parallel|Box Topper|Alternate Art|Manga|SP)\)',d['name'] or ''): d['alt']=1
        cards.append(d)
    def key(c):
        m=re.match(r'([A-Z]+)(\d+)-(\d+)(?:_(\w+))?',c['n'] or '')
        return (int(m.group(3)),m.group(4) or '') if m else (9999,c['n'])
    cards.sort(key=key); return cards
def save(sid,name,rows,kind):
    cards=conv(rows)
    dates=sorted({c['p']['d'] for c in cards if c.get('p') and c['p'].get('d')})
    meta={'id':'op-'+sid,'cat':'onepiece','api':'optcg','apiId':sid,'apiKind':kind,'name':f'{sid} {name}','series':'Starter Decks' if kind=='deck' else ('Extra Booster' if sid.startswith('EB') else ('Premium Booster' if sid.startswith('PRB') else 'Booster')),
      'total':len(cards),'official':sum(1 for c in cards if not c.get('alt')),'source':{'name':'OPTCG API','url':'https://optcgapi.com'},
      'priceSource':'Marknadspris (USD) via OPTCG API','priceDate':dates[-1] if dates else None,'fetched':time.strftime('%Y-%m-%d')}
    json.dump({**meta,'cards':cards},open(f'{OUT}/op-{sid}.json','w'),ensure_ascii=False,separators=(',',':'))
    print(sid,name,len(cards),flush=True); return meta
metas=[]
for s in get('https://optcgapi.com/api/allSets/'):
    try: metas.append(save(s['set_id'],s['set_name'],get(f"https://optcgapi.com/api/sets/{s['set_id']}/"),'set'))
    except Exception as e: print('FAIL',s,e)
# starter decks from the bulk endpoint
try:
    st=json.load(open('/tmp/st.json')) if os.path.exists('/tmp/st.json') else get('https://optcgapi.com/api/allSTCards/')
    by={}
    for x in st: by.setdefault(x['set_id'],[]).append(x)
    for sid,rows in sorted(by.items()):
        import collections
        nm=collections.Counter(x['set_name'] for x in rows if re.match(r'(Starter|Ultra) Deck',x.get('set_name') or ''))
        metas.append(save(sid,(nm.most_common(1)[0][0] if nm else sid),rows,'deck'))
except Exception as e: print('FAIL ST',e)
json.dump(metas,open(os.path.join(OUT,'..','onepiece_index.json'),'w'),ensure_ascii=False,indent=0)
