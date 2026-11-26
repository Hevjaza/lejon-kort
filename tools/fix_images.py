"""Kontrollera kortbilder och fyll i saknade från publika CDN:er (Limitless TCG, pokemontcg.io).
Sätter card['img'] (TCGdex-bas, appen lägger till /low.webp) eller card['imgf'] (full URL till liten bild; '_SM'→'_LG' för stor)."""
import json,os,re,sys,glob,urllib.request,concurrent.futures as cf
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data','sets')
LIM='https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com'
ENCODE={'svp':'SVP','mep':'MEP','swsh12.5gg':'CRZ','swsh4.5sv':'SHF','cel25cc':'CEL','cel25':'CEL'}
PTCG={'svp':'svp','swsh12.5gg':'swsh12pt5gg','swsh4.5sv':'swsh45sv'}
def ok(u):
    for _ in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(u,method='HEAD',headers={'User-Agent':'LejonKort/1.0'}),timeout=20) as r:
                return r.status==200 and 'image' in r.headers.get('Content-Type','')
        except urllib.error.HTTPError: return False
        except Exception: pass
    return False
def nums(n):
    m=re.match(r'^([A-Za-z]*)(\d+)([A-Za-z]*)$',n or '')
    if not m: return [n]
    p,d,s=m.groups(); i=int(d)
    return list(dict.fromkeys([n,f'{p}{i}{s}',f'{p}{i:03d}{s}']))
def cands(meta,c):
    out=[]
    if meta.get('lang')=='ja':
        for x in nums(c['n']): out.append(f"{LIM}/tpc/{meta['apiId']}/{meta['apiId']}_{x}_R_JP_SM.png")
    else:
        a=meta['apiId']; code=ENCODE.get(a)
        if code:
            for x in nums(c['n']): out.append(f"{LIM}/tpci/{code}/{code}_{x}_R_EN_SM.png")
        if a in PTCG:
            for x in nums(c['n']): out.append(f"https://images.pokemontcg.io/{PTCG[a]}/{x}.png")
    return out
def fix(args):
    meta,c=args
    if c.get('img') and ok(c['img']+'/low.webp'): c.pop('imgf',None); return 'tcgdex'
    if c.get('imgf') and ok(c['imgf']): return 'kept'
    for u in cands(meta,c):
        if ok(u): c['imgf']=u; c.pop('img',None); return 'fallback'
    c.pop('img',None); return 'none'
if __name__=='__main__':
    files=sys.argv[1:] or sorted(glob.glob(os.path.join(D,'pk*-*.json')))
    rep={}
    for f in files:
        d=json.load(open(f)); meta={k:v for k,v in d.items() if k!='cards'}
        with cf.ThreadPoolExecutor(32) as ex: res=list(ex.map(fix,[(meta,c) for c in d['cards']]))
        json.dump(d,open(f,'w'),ensure_ascii=False,separators=(',',':'))
        r={k:res.count(k) for k in set(res)}; rep[d['id']]=r; print(d['id'],len(res),r,flush=True)
    json.dump(rep,open('/tmp/imgreport.json','w'),indent=0)
