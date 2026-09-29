# -*- coding: utf-8 -*-
import json, csv, os, hashlib, re
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
def tsv(p):
    with open(p, newline='', encoding='utf-8') as fh:
        return [(r[0], r[1]) for r in csv.reader(fh, delimiter='\t') if len(r)==2]
def cid(deck, front):
    return deck+"-"+hashlib.sha1(front.encode()).hexdigest()[:10]
def section(front):
    m=re.match(r'^(\d{2}\s+[A-Z][A-Z0-9-]*)', front)
    if m: return m.group(1)
    if front.startswith("PAIR - "): return "Synonym pairs"
    if front.startswith("SECOND MEANING - "): return "Second meanings"
    return "Words"
def mk(did,title,desc,level,pairs):
    cards=[{"id":cid(did,f),"front":f,"back":b,"section":section(f)} for f,b in pairs]
    return {"id":did,"title":title,"description":desc,"level":level,"count":len(cards),"cards":cards}

decks=[]
# 1 vocab core
decks.append(mk("vocab-core","Vocabulary - Core",
  "303 high-frequency SAT words, 87% attested in College Board's own question bank and published practice tests.","1000 to 1300",
  tsv(os.path.join(HERE,"sources","vocab-core.src.tsv"))))
# 2 vocab hard
exec(open(os.path.join(HERE,"vocab_hard.py")).read()); exec(open(os.path.join(HERE,"vocab_hard2.py")).read())
vh=[(f"{w}",d) for w,d in A]+[(f"PAIR - {w}",d) for w,d in B]+[(f"SECOND MEANING - {w}",d) for w,d in C]
decks.append(mk("vocab-hard","Vocabulary - Advanced",
  "Harder words, near-synonym discrimination pairs, and common words used in their uncommon SAT senses.","1300 to 1450",vh))
# 3 transitions core (rebuilt with example sentences)
exec(open(os.path.join(HERE,"trans_core.py")).read())
tc=list(T0)+[(f"{sec} · {w}", f"{fn}. {note} | EXAMPLE: {ex}") for sec,w,fn,note,ex in T]
decks.append(mk("transitions-core","Transitions - Core",
  "Every transition College Board uses, grouped by the relationship it signals, each with an example sentence.","1000 to 1300",tc))
# 4 transitions hard
exec(open(os.path.join(HERE,"trans_hard.py")).read())
decks.append(mk("transitions-hard","Transitions - Advanced",
  "Full in-context questions with four options, plus why each distractor fails.","1300 to 1450",TH))
# 5 math core
decks.append(mk("math-core","Math Signals - Core",
  "170 signal-to-method cards, Desmos first, grouped by question type and ordered easy to hard within each type.","1000 to 1300",
  tsv(os.path.join(HERE,"sources","math-core.src.tsv"))))
# 6 math hard
exec(open(os.path.join(HERE,"math_hard.py")).read())
decks.append(mk("math-hard","Math Signals - Advanced",
  "Classify-it-yourself questions with no type given, plus the harder content tier: circles, trig, tangency and symbolic work.","1300 to 1450",MH))

os.makedirs(os.path.join(ROOT,"data"),exist_ok=True)
index=[]
for d in decks:
    with open(os.path.join(ROOT,"data",d["id"]+".json"),"w",encoding='utf-8') as fh:
        json.dump(d,fh,ensure_ascii=False,separators=(',',':'))
    index.append({k:d[k] for k in ("id","title","description","level","count")})
    # regenerate/emit a Quizlet TSV for every deck
    with open(os.path.join(ROOT,"decks",d["id"]+".tsv"),"w",encoding='utf-8') as fh:
        for c in d["cards"]: fh.write(f'{c["front"]}\t{c["back"]}\n')
with open(os.path.join(ROOT,"data","index.json"),"w",encoding='utf-8') as fh:
    json.dump({"decks":index},fh,ensure_ascii=False,indent=1)
print(f"{'deck':22} {'cards':>6}  sections")
for d in decks:
    print(f"{d['id']:22} {d['count']:6}  {len(set(c['section'] for c in d['cards']))}")
print("TOTAL",sum(d['count'] for d in decks))
