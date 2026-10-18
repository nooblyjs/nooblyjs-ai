import os,re,sys,difflib,collections
src,tgt=sys.argv[1],sys.argv[2]
skip={'node_modules','.temp','temp','.git','data'}
def walk(r,sub='src'):
    out={}
    base=os.path.join(r,sub)
    for d,ds,fs in os.walk(base):
        ds[:]=[x for x in ds if x not in skip]
        for f in fs:
            p=os.path.join(d,f); out[os.path.relpath(p,r)]=p
    return out
def norm(p):
    try: t=open(p,encoding='utf-8',errors='replace').read()
    except: return []
    t=t.replace('\r','')
    t=re.sub(r'(?i)engx|nooblyjs|noobly','X',t)
    return [l for l in t.split('\n') if not re.match(r'\s*(import |export \{.*\} from|} from )',l)]
sub=sys.argv[3] if len(sys.argv)>3 else 'src'
S=walk(src,sub); T=walk(tgt,sub)
byname=collections.defaultdict(list)
for k,v in T.items(): byname[os.path.basename(k)].append(v)
same=changed=new=0; newl=[]; chl=[]
for k,p in sorted(S.items()):
    c=byname.get(os.path.basename(k))
    if not c: new+=1; newl.append((k,len(norm(p)))); continue
    a=norm(p); best=min(sum(1 for l in difflib.unified_diff(a,norm(q),n=0) if l[:1] in '+-' and l[:3] not in('+++','---')) for q in c)
    if best==0: same+=1
    else: changed+=1; chl.append((best,k))
print(f"same={same} changed={changed} new={new}")
for b,k in sorted(chl,reverse=True)[:40]: print("CHANGED",b,k)
for k,n in newl: print("NEW",n,k)
