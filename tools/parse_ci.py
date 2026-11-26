"""Parse checklistinsider.com checklist pages (real published checklists) into compact JSON."""
import re,html,json,sys
SKIP=re.compile(r'penmanship|ink|auto|signature|memorabilia|jersey|patch|relic|swatch|materials|inscri|sign',re.I)
def text(path):
    t=open(path,encoding='utf8',errors='ignore').read()
    t=re.sub(r'<script.*?</script>|<style.*?</style>','',t,flags=re.S)
    t=re.sub(r'<br\s*/?>|</p>|</li>|</h\d>|</div>|<h\d[^>]*>',lambda m:'\n',t)
    t=html.unescape(re.sub('<[^>]+>','',t))
    return [l.strip() for l in t.split('\n') if l.strip()]
CARD=re.compile(r'^([A-Z]{0,5}-?\d{1,4}[A-Za-z]?)\s+(.+?)\s+-\s+(.+?)$')
def parse(path):
    L=text(path); secs=[]; cur=None; mode=None
    for i,l in enumerate(L):
        if l.endswith(' Checklist') and i+1<len(L) and re.match(r'^\d+ cards',L[i+1]):
            name=l[:-len(' Checklist')].strip()
            cur={'name':name,'count':int(re.match(r'^(\d+)',L[i+1]).group(1)),'parallels':[],'cards':[],'skip':bool(SKIP.search(name))}
            secs.append(cur); mode='head'
            if 'Parallels:' in L[i+1]:
                mode='par'; rest=L[i+1].split('Parallels:',1)[1].strip()
                if rest: cur['parallels'].append(rest)
            continue
        if cur is None: continue
        if l.startswith('Parallels:'):
            mode='par'; rest=l[len('Parallels:'):].strip()
            if rest:
                for p in rest.rstrip('.').split(';'):
                    p=re.sub(r'\s*\(.*?\)\s*','',p).strip()
                    if p: cur['parallels'].append(p)
            continue
        m=CARD.match(l)
        if m and not l.startswith('1:'):
            mode='cards'; num,name,team=m.groups()
            team=re.sub(r'\s*\(eBay\)\s*$','',team).strip()
            rc=bool(re.search(r'\bRC\b',team)); team=re.sub(r'\s+(RC|CL|SP|SSP)\b.*$','',team).strip()
            cur['cards'].append({'n':num,'name':name,'team':team,**({'rc':1} if rc else {})}); continue
        if mode=='par':
            if 'ePack Achievements' in l: l=l.split('ePack Achievements')[0]
            if ';' in l:
                cur['parallels']+= [x.strip() for x in re.sub(r'\(.*?\)','',l).rstrip('.').split(';') if x.strip()]; continue
            p=re.sub(r'\s*\(.*?\)\s*','',l).strip().rstrip('.')
            if p and len(p)<40 and not re.search(r'cards\.|Odds',p): cur['parallels'].append(p)
        if mode=='cards' and not m and len(cur['cards'])>=cur['count']: mode=None
    out=[]
    for s in secs:
        if s['skip'] or not s['cards']: continue
        seen=set(); cards=[]
        for c in s['cards']:
            if c['n'] in seen: continue
            seen.add(c['n']); cards.append(c)
        out.append({'name':s['name'],'declared':s['count'],'parallels':s['parallels'],'cards':cards})
    return out
if __name__=='__main__':
    for p in sys.argv[1:]:
        r=parse(p); print(p)
        for s in r: print('  %-45s decl=%4d got=%4d par=%d %s'%(s['name'][:45],s['declared'],len(s['cards']),len(s['parallels']),s['parallels'][:4]))
