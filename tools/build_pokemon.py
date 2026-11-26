"""Bundle real Pokémon TCG sets + Cardmarket/TCGplayer prices from TCGdex (api.tcgdex.net)."""
import json,os,sys,time,urllib.request,concurrent.futures as cf
API='https://api.tcgdex.net/v2/en'
OUT=os.path.join(os.path.dirname(__file__),'..','data','sets'); os.makedirs(OUT,exist_ok=True)
SETS=['me06','30th','me05','me04','me03','me02.5','me02','me01','mep',
'sv10.5w','sv10.5b','sv10','sv09','sv08.5','sv08','sv07','sv06.5','sv06','sv05','sv04.5','sv04','sv03.5','sv03','sv02','sv01','svp',
'swsh12.5','swsh12.5gg','swsh7','cel25','cel25cc','swsh4.5','swsh4.5sv','base1','base2','base3','base5']
def get(u,tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'LejonKort/1.0'}),timeout=30) as r: return json.load(r)
        except Exception as e:
            if i==tries-1: raise
            time.sleep(1.5*(i+1))
def r2(x):
    return round(x,2) if isinstance(x,(int,float)) and x>0 else None
def prices(pr):
    if not pr: return None
    out={}
    cm=pr.get('cardmarket') or {}
    for k,kk in (('trend','t'),('trend-holo','th'),('avg30','a30'),('avg30-holo','a30h'),('low','l')):
        v=r2(cm.get(k))
        if v: out['cm_'+kk]=v
    if cm.get('updated'): out['cmd']=cm['updated'][:10]
    tp=pr.get('tcgplayer') or {}
    for k,v in tp.items():
        if isinstance(v,dict):
            m=r2(v.get('marketPrice')) or r2(v.get('midPrice'))
            if m: out['tp_'+k]=m
    if tp.get('updated'): out['tpd']=tp['updated'][:10]
    return out or None
ORDER=['normal','holo','reverse','first']
TPV={'tp_normal':'normal','tp_holofoil':'holo','tp_reverse-holofoil':'reverse','tp_unlimited':'normal','tp_unlimited-holofoil':'holo','tp_1st-edition':'first','tp_1st-edition-holofoil':'first'}
VMAP={'normal':'normal','reverse':'reverse','holo':'holo','firstEdition':'first'}
def card(cid):
    c=get(f'{API}/cards/{cid}')
    v=[VMAP[k] for k,on in (c.get('variants') or {}).items() if on and k in VMAP]
    d={'id':cid,'n':c.get('localId'),'name':c.get('name'),'r':c.get('rarity'),'v':v or ['normal']}
    if c.get('image'): d['img']=c['image']
    p=prices(c.get('pricing'))
    if p: d['p']=p
    # Nyaste set saknar ibland variantdata i TCGdex: härled då varianter från vilka TCGplayer-produkter som har pris
    if d['v']==['normal'] and p:
        inf=sorted({TPV[k] for k in p if k in TPV},key=ORDER.index)
        if inf and inf!=['normal']: d['v']=inf; d['vinf']=1
    d['v']=sorted(d['v'],key=lambda x:ORDER.index(x) if x in ORDER else 9)
    return d
def build(sid):
    s=get(f'{API}/sets/{sid}')
    ids=[c['id'] for c in s.get('cards',[])]
    with cf.ThreadPoolExecutor(16) as ex: cards=list(ex.map(card,ids))
    dates=sorted({c['p'].get('cmd') or c['p'].get('tpd') for c in cards if c.get('p')} - {None})
    meta={'id':'pk-'+sid,'cat':'pokemon','api':'tcgdex','apiId':sid,'name':s['name'],'series':(s.get('serie') or {}).get('name'),
          'release':s.get('releaseDate'),'official':(s.get('cardCount') or {}).get('official'),'total':len(cards),
          'logo':s.get('logo'),'symbol':s.get('symbol'),
          'source':{'name':'TCGdex','url':f'https://tcgdex.dev'},'priceSource':'Cardmarket (EUR) + TCGplayer (USD) via TCGdex',
          'priceDate':dates[-1] if dates else None,'fetched':time.strftime('%Y-%m-%d')}
    json.dump({**meta,'cards':cards},open(f'{OUT}/pk-{sid}.json','w'),ensure_ascii=False,separators=(',',':'))
    print(sid,s['name'],len(cards),'priced',sum(1 for c in cards if c.get('p')),flush=True)
    return meta
if __name__=='__main__':
    sets=sys.argv[1:] or SETS; metas=[]
    for sid in sets:
        try: metas.append(build(sid))
        except Exception as e: print('FAIL',sid,e,flush=True)
    json.dump(metas,open(os.path.join(OUT,'..','pokemon_index.json'),'w'),ensure_ascii=False,indent=0)
