"""Compact search index for the card scanner: data/search.json = {sets:[[id,cat,official,apiId,lang]], c:[[setIdx,cardIdx,number,name]]}"""
import json,os
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data')
idx=json.load(open(os.path.join(D,'index.json')))
sets=[];cards=[]
for si,m in enumerate(idx['sets']):
    d=json.load(open(os.path.join(D,'sets',m['id']+'.json')))
    sets.append([m['id'],m['cat'],m.get('official') or 0,m.get('apiId') or '',m.get('lang') or 'en'])
    for ci,c in enumerate(d['cards']): cards.append([si,ci,c.get('n') or '',c.get('name') or ''])
json.dump({'generated':idx['generated'],'sets':sets,'c':cards},open(os.path.join(D,'search.json'),'w'),ensure_ascii=False,separators=(',',':'))
print(len(sets),len(cards),os.path.getsize(os.path.join(D,'search.json')))
