import json,re,datetime,collections
import os
SP=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','data','win-training')+'/'
raw=json.load(open(SP+'fb_raw.json')); L=json.load(open(SP+'crawl_list.json')); recs=json.load(open(SP+'all_rows.json'))
def num(s):
    if not s: return None
    t=s.strip().lower().replace(' ','')
    m=re.match(r'^([\d.,]+)(triệu|tr|nghìn|k|n)?$',t)
    if not m: return None
    if m.group(2):
        v=float(m.group(1).replace(',','.')); return int(round(v*(1e6 if m.group(2) in('triệu','tr') else 1e3)))
    return int(re.sub(r'[.,]','',m.group(1)))
# year inference by file order (neo theo tháng, tăng năm khi tháng tụt >=6 so với tháng trước)
year=2024; prev=None; yr={}
for i,r in enumerate(recs):
    m=re.match(r'(\d+)/(\d+)',r['ngay'])
    if not m: continue
    d,mo=int(m.group(1)),int(m.group(2))
    if mo>12 or d>31: continue
    if prev and mo<prev-6: year+=1
    if prev is None or abs(mo-prev)<=6 or mo<prev: prev=mo if not (prev and mo>prev+6) else prev
    yr[i]=(d,mo,year)
idx={r['link']:i for i,r in enumerate(recs) if r['link']}
PAGE='Hạt Nêm Chay Enzy - Cải Thiện Sức Khoẻ Cho Người Ăn Chay'
def parse(x):
    t=x.get('text',''); o={}
    m=re.search(r'Chia sẻ ([\d.,]+ ?[KkNn]?) · ([\d.,]+ ?[KkNn]?) bình luận(?: · ([\d.,]+ ?(?:triệu|nghìn|[KkNn])?) lượt xem)?',t)
    if m: o['react'],o['comm'],o['views']=num(m.group(1)),num(m.group(2)),num(m.group(3))
    else:
        m=re.search(r'Công khai ([\d.,]+[KkNn]?)(?: ([\d.,]+[KkNn]?))?(?: ([\d.,]+[KkNn]?))? (?:Reels|Xem thêm trên|Đăng|Email)',t)
        if m: o['react'],o['comm'],o['share']=num(m.group(1)),num(m.group(2)),num(m.group(3))
    sh=re.search(r'([\d.,]+ ?[KkNn]?) lượt chia sẻ',x.get('ogTitle',''))
    if sh and 'share' not in o: o['share']=num(sh.group(1))
    dm=re.search(r'(\d{1,2}) [Tt]háng (\d{1,2}), (\d{4})',t)
    if dm: o['date']=(int(dm.group(1)),int(dm.group(2)),int(dm.group(3)))
    # caption
    cap=''
    s=re.search(r'\d+:\d{2} / \d+:\d{2} (.*?) Thích Bình luận Chia sẻ',t)
    if s: cap=s.group(1)
    else:
        s=re.search(r'Bạn quên tài khoản ư\? (.*?) '+re.escape(PAGE),t)
        if s: cap=s.group(1)
    og=x.get('ogDesc','')
    if len(og)>len(cap)+20 or not cap: cap=og
    cap=re.sub(r'… Xem thêm|Xem thêm$|Ẩn bớt','',cap).strip()
    o['caption']=cap; o['dur']=x.get('dur')
    return o
rows=[]
for r in L:
    x=raw.get(r['link'])
    if not x or x.get('error'): continue
    o=parse(x); i=idx.get(r['link'])
    if not o.get('date') and i in yr: o['date']=yr[i]; o['date_src']='csv'
    r2=dict(r); r2.update(o); rows.append(r2)
json.dump(rows,open(SP+'parsed.json','w'),ensure_ascii=False)
print(len(rows),'parsed;', 'with caption',sum(1 for r in rows if len(r['caption'])>30),'react',sum(1 for r in rows if r.get('react')),'views',sum(1 for r in rows if r.get('views')),'dur',sum(1 for r in rows if r.get('dur')))
print(collections.Counter(r['group'] for r in rows))
