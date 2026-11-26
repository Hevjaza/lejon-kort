"""Build sports set checklists from real published checklists:
 - Fotboll: soccr.cloud (machine-readable .md checklists)
 - Basket & Hockey: checklistinsider.com checklist pages
No prices are bundled (no free public sports-card price API exists)."""
import json,os,re,time
import parse_ci
HERE=os.path.dirname(os.path.abspath(__file__)); SRC=os.path.join(HERE,'sources')
OUT=os.path.join(HERE,'..','data','sets'); os.makedirs(OUT,exist_ok=True)
SKIP=re.compile(r'auto|signature|ink\b|penmanship|graphs|memorabilia|jersey|patch|relic|swatch',re.I)
def slug(s): return re.sub(r'[^a-z0-9]+','-',s.lower()).strip('-')
def soccr(fname):
    t=open(os.path.join(SRC,fname),encoding='utf8').read()
    meta={k:v for k,v in re.findall(r'^- \*\*(.+?):\*\* (.+)$',t,re.M)}
    title=re.match(r'# (.+?) – checklist',t).group(1)
    subs=[]; cur=None; inpar=False
    for line in t.split('\n'):
        if line.startswith('### '):
            name=line[4:].strip(); cur={'name':name,'parallels':[],'cards':[],'skip':bool(SKIP.search(name))}; subs.append(cur); inpar=False; continue
        if line.startswith('#### ') and cur and 'parallels' in line: inpar=True; continue
        if line.startswith('## '): cur=None; continue
        if not cur: continue
        if inpar and line.startswith('- '): cur['parallels'].append(line[2:].strip()); continue
        if line.startswith('|'):
            cells=[x.strip() for x in line.strip().strip('|').split('|')]
            if len(cells)<3 or cells[0] in ('No.','-',''): continue
            n,name,team=cells[:3]; feat=cells[3] if len(cells)>3 else ''
            c={'n':n,'name':name,'team':team}
            if 'Rookie' in feat: c['rc']=1
            cur['cards'].append(c)
    subs=[s for s in subs if not s['skip'] and s['cards']]
    return title,meta,subs,'https://www.soccr.cloud/en/sets/'+fname[2:-3]
def ci(fname,title,release):
    subs=parse_ci.parse(os.path.join(SRC,fname))
    subs=[s for s in subs if not SKIP.search(s['name'])]
    return title,{'Release date':release},subs,'https://www.checklistinsider.com/'+fname[3:-5]
def save(cat,title,meta,subs,url,srcname):
    sid=cat[:2]+'-'+slug(title)
    cards=[]; subsets=[]
    for i,s in enumerate(subs):
        base = i==0 or s['name'] in ('Base','Base Set','Base Young Guns')
        subsets.append({'name':s['name'],'base':base,'parallels':s['parallels']})
        for c in s['cards']:
            d={'id':f"{sid}-{slug(s['name'])}-{slug(c['n'])}",'n':c['n'],'name':c['name'],'team':c.get('team'),'sub':i}
            if c.get('rc'): d['rc']=1
            cards.append(d)
    base_total=sum(1 for c in cards if subsets[c['sub']]['base'])
    m={'id':sid,'cat':cat,'name':title,'release':meta.get('Release date'),'total':len(cards),'official':base_total,
       'subsets':subsets,'source':{'name':srcname,'url':url},'priceSource':None,'fetched':time.strftime('%Y-%m-%d')}
    json.dump({**m,'cards':cards},open(f'{OUT}/{sid}.json','w'),ensure_ascii=False,separators=(',',':'))
    print(cat,title,'base',base_total,'all',len(cards),'subsets',len(subsets))
    m=dict(m); m['subsets']=[{'name':s['name'],'base':s['base']} for s in subsets]; return m
metas=[]
FOT=['s_topps-chrome-uefa-club-competitions-2025-26.md','s_topps-chrome-premier-league-2025-26.md','s_panini-prizm-fifa-world-cup-2026.md',
     's_topps-chrome-uefa-club-competitions-2024-25.md','s_panini-prizm-premier-league-2024-25.md']
for f in FOT:
    t,meta,subs,url=soccr(f); metas.append(save('fotboll',t,meta,subs,url,'soccr.cloud'))
BAS=[('ci_2025-26-topps-chrome-basketball.html','2025-26 Topps Chrome Basketball','2025-12-18'),
     ('ci_2025-26-topps-basketball.html','2025-26 Topps Basketball','2025-10-23'),
     ('ci_2024-25-panini-prizm-basketball.html','2024-25 Panini Prizm Basketball',None),
     ('ci_2023-24-panini-prizm-basketball.html','2023-24 Panini Prizm Basketball',None)]
for f,t,r in BAS:
    t,meta,subs,url=ci(f,t,r); metas.append(save('basket',t,meta,subs,url,'Checklist Insider'))
HOC=[('ci_2026-27-upper-deck-series-1-hockey.html','2026-27 Upper Deck Series 1 Hockey','2026-10-07'),
     ('ci_2025-26-upper-deck-series-2-hockey.html','2025-26 Upper Deck Series 2 Hockey','2026-03-04'),
     ('ci_2025-26-upper-deck-series-1-hockey.html','2025-26 Upper Deck Series 1 Hockey',None),
     ('ci_2024-25-upper-deck-series-1-hockey.html','2024-25 Upper Deck Series 1 Hockey',None)]
for f,t,r in HOC:
    t,meta,subs,url=ci(f,t,r); metas.append(save('hockey',t,meta,subs,url,'Checklist Insider'))
json.dump(metas,open(os.path.join(OUT,'..','sports_index.json'),'w'),ensure_ascii=False,indent=0)
