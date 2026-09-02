"""
training-mode.md 수치 검증용 간이 시뮬레이터.
문서에 적을 상수를 그대로 구현하고, (1) 12턴 워크드 예시(기대값, 난수 0) (2) 정책별 몬테카를로를 뽑는다.
"""
import random, statistics, copy
from collections import Counter

STATS = ["serve","receive","set","spike","block","dig","speed","power","stamina","mental"]

# ---------- 상수 ----------
BASE = 5.0
W_PRIMARY, W_SEC1, W_SEC2 = 1.0, 0.5, 0.25
DIMINISH_FULL = 20.0   # 남은 잠재력 >= 20 이면 100%
DIMINISH_MIN = 0.25
COND_MULT = {4:1.25, 3:1.10, 2:1.00, 1:0.85, 0:0.65}  # 4=절호조 ... 0=최악
COND_NAME = {4:"절호조",3:"호조",2:"보통",1:"부진",0:"최악"}
APT = {"S":1.30,"A":1.15,"B":1.00,"C":0.70,"D":0.40}
RAND_EPS = 0.25
HOT_ZONE = True   # 피로 50~79 훈련 효율 x1.10, 80+ x0.85
POS_SCALE = {"S":1.0,"OH":1.0,"OP":1.0,"MB":1.0,"L":0.95}

FATIGUE_TRAIN = 20.0
FATIGUE_SPECIAL = 30.0
FATIGUE_MATCH = 12.0
FATIGUE_PASSIVE = 5.0       # 매 턴 자연 회복
FATIGUE_REST = 45.0         # 휴식 (자연회복 포함 총량)
REST_MENTAL = 1.0

INJ_START = 40.0
INJ_MAX = 0.40
INJ_EXP = 1.6
TRAIN_RISK = {"serve":0.8,"receive":1.0,"set":0.7,"spike":1.3,"block":1.2,"special":1.5}
SEVERE_RATIO = 0.30

SPECIAL_BASE_MULT = 1.5
SPECIAL_W = (1.0, 0.7, 0.5)

TRAINING = {  # 주 / 부1 / 부2
    "serve":   ("serve","power","mental"),
    "receive": ("receive","dig","stamina"),
    "set":     ("set","mental","speed"),
    "spike":   ("spike","power","stamina"),
    "block":   ("block","speed","power"),
}
POS_APT = {
    "S":  {"serve":"B","receive":"B","set":"S","spike":"C","block":"B"},
    "OH": {"serve":"A","receive":"A","set":"C","spike":"A","block":"B"},
    "OP": {"serve":"A","receive":"C","set":"D","spike":"S","block":"B"},
    "MB": {"serve":"B","receive":"C","set":"D","spike":"A","block":"S"},
    "L":  {"serve":"D","receive":"S","set":"B","spike":"D","block":"D"},
}
POS_W = {
    "S":  {"set":.30,"mental":.12,"speed":.10,"serve":.10,"receive":.08,"dig":.08,"block":.08,"spike":.06,"power":.04,"stamina":.04},
    "OH": {"spike":.22,"receive":.18,"serve":.10,"power":.10,"dig":.08,"speed":.08,"block":.08,"stamina":.06,"mental":.06,"set":.04},
    "OP": {"spike":.28,"power":.14,"serve":.12,"block":.10,"stamina":.08,"speed":.08,"mental":.08,"receive":.05,"dig":.04,"set":.03},
    "MB": {"block":.26,"spike":.18,"power":.14,"speed":.10,"serve":.08,"stamina":.08,"mental":.06,"receive":.04,"dig":.03,"set":.03},
    "L":  {"receive":.28,"dig":.26,"speed":.16,"mental":.10,"stamina":.10,"set":.06,"power":.04,"serve":0,"spike":0,"block":0},
}
CORE3 = {"S":["set","mental","speed"],"OH":["spike","receive","serve"],"OP":["spike","power","serve"],
         "MB":["block","spike","power"],"L":["receive","dig","speed"]}
SPECIAL_STATS = CORE3
GRADE_TH = [("S",80),("A",74),("B",66),("C",55),("D",-1)]

# 예시 카드: SSR OH
CARD = {
    "name":"SSR OH 예시", "pos":"OH",
    "stats":    {"serve":62,"receive":66,"set":50,"spike":72,"block":58,"dig":60,"speed":68,"power":66,"stamina":64,"mental":60},
    "potential":{"serve":82,"receive":90,"set":60,"spike":98,"block":74,"dig":80,"speed":88,"power":88,"stamina":84,"mental":82},
}
for p in POS_W: assert abs(sum(POS_W[p].values())-1)<1e-9, p

def ovr(stats,pos): return POS_SCALE[pos]*sum(POS_W[pos][s]*stats[s] for s in STATS)
def grade(o):
    for g,t in GRADE_TH:
        if o>=t: return g
def diminish(cur,pot):
    rem = pot-cur
    if rem<=0: return 0.0
    return max(DIMINISH_MIN, min(1.0, rem/DIMINISH_FULL))
def injury_p(fatigue, risk):
    if fatigue<INJ_START: return 0.0
    return min(1.0, INJ_MAX*((fatigue-INJ_START)/(100-INJ_START))**INJ_EXP*risk)
def fatigue_gain(base, stamina): return base*(1-(stamina-60)/250)

class Run:
    def __init__(self, card, rng, deterministic=False, support=0.0):
        self.card=card; self.pos=card["pos"]; self.rng=rng; self.det=deterministic
        self.cur=dict(card["stats"]); self.pot=card["potential"]; self.init=dict(card["stats"])
        self.fatigue=0.0; self.cond=2; self.turn=1; self.support=support
        self.injured_turns=0; self.injuries=0; self.severe=0; self.turns_lost=0
        self.hints=0; self.rand_events=0; self.log=[]; self.special_available=False; self.match_results=[]
    def eps(self): return 0.0 if self.det else self.rng.uniform(-RAND_EPS,RAND_EPS)
    def apply_gain(self, stat, raw):
        rem=self.pot[stat]-self.cur[stat]
        g=min(raw, max(0.0,rem)); self.cur[stat]+=g; return g
    def train_gains(self, kind, preview=False):
        """kind: serve/receive/set/spike/block/special -> dict stat->gain (기대값 preview면 eps=0)"""
        out={}
        cm=COND_MULT[self.cond]*(1+self.support)
        if HOT_ZONE:
            if 50<=self.fatigue<80: cm*=1.10
            elif self.fatigue>=80: cm*=0.85
        if kind=="special":
            for stat,w in zip(SPECIAL_STATS[self.pos], SPECIAL_W):
                raw=BASE*SPECIAL_BASE_MULT*w*diminish(self.cur[stat],self.pot[stat])*cm
                out[stat]=raw
        else:
            apt=APT[POS_APT[self.pos][kind]]
            for stat,w in zip(TRAINING[kind],(W_PRIMARY,W_SEC1,W_SEC2)):
                raw=BASE*w*apt*diminish(self.cur[stat],self.pot[stat])*cm
                out[stat]=raw
        if not preview:
            e=self.eps(); out={k:v*(1+e) for k,v in out.items()}
        return out
    def do_action(self, action, forced_injury=None):
        """action: train kind / 'rest'. returns dict"""
        rec={"turn":self.turn,"action":action,"fatigue_before":self.fatigue,"cond":self.cond,"gains":{},"injury":None,"inj_p":0.0}
        if self.injured_turns>0:
            rec["action"]="치료"; self.injured_turns-=1; self.turns_lost+=1
            self.fatigue=max(0,self.fatigue-20)
        elif action=="rest":
            self.fatigue=max(0,self.fatigue-FATIGUE_REST)
            rec["gains"]["mental"]=self.apply_gain("mental",REST_MENTAL)
        else:
            risk=TRAIN_RISK[action]; p=injury_p(self.fatigue,risk); rec["inj_p"]=p
            hit = forced_injury if forced_injury is not None else ((not self.det) and self.rng.random()<p)
            if hit:
                self.injuries+=1
                severe = self.rng.random()<SEVERE_RATIO
                if severe:
                    self.severe+=1; self.injured_turns=2; self.cond=0
                    for s in ["speed","power","stamina"]: self.cur[s]=max(0,self.cur[s]-3)
                    rec["injury"]="중상"
                else:
                    self.injured_turns=1; self.cond=max(0,self.cond-1); rec["injury"]="경상"
            else:
                for s,g in self.train_gains(action).items(): rec["gains"][s]=self.apply_gain(s,g)
                fb=FATIGUE_SPECIAL if action=="special" else FATIGUE_TRAIN
                self.fatigue=min(100,self.fatigue+fatigue_gain(fb,self.cur["stamina"]))
                if action=="special": self.hints+=1
        # 자연 회복
        if action!="rest" and rec["action"]!="치료": self.fatigue=max(0,self.fatigue-FATIGUE_PASSIVE)
        # 컨디션 드리프트
        if rec["injury"] is None and rec["action"]!="치료":
            self.drift_condition(action=="rest")
        rec["fatigue_after"]=self.fatigue; rec["cond_after"]=self.cond
        self.log.append(rec); return rec
    def drift_condition(self, rested):
        if self.det:
            # 워크드 예시용 결정론: 휴식이면 +1, 피로>=80이면 -1, 피로 60~79면 2턴 연속 시 -1 (단순화: 유지)
            if rested: self.cond=min(4,self.cond+1)
            elif self.fatigue>=80: self.cond=max(0,self.cond-1)
            return
        r=self.rng.random()
        if rested: up,down=(0.70,0.0)
        elif self.fatigue<60: up,down=(0.15,0.15)
        elif self.fatigue<80: up,down=(0.05,0.35)
        else: up,down=(0.0,0.60)
        if r<up: self.cond=min(4,self.cond+1)
        elif r<up+down: self.cond=max(0,self.cond-1)
    def eval_match(self, opp_strength, forced=None):
        """활약도 0~100 -> 보상. forced=(win, perf)로 결정론 지정."""
        if self.injured_turns>0 and forced is None:
            self.match_results.append(("결장",0)); return {"result":"결장"}
        core=statistics.mean(self.cur[s] for s in CORE3[self.pos])
        if forced: win,perf=forced
        else:
            perf=max(0,min(100, 50+(core-opp_strength)*1.5+self.rng.gauss(0,12)))
            win=self.rng.random() < 1/(1+2.718**(-(core-opp_strength)/8))
        gains={}
        if perf>=80: bonus,hint=2,2
        elif perf>=60: bonus,hint=1,1
        elif perf>=40: bonus,hint=0,0
        else: bonus,hint=0,0
        for s in CORE3[self.pos]: gains[s]=self.apply_gain(s,bonus)
        if win: hint+=1
        else: gains["mental"]=self.apply_gain("mental",1)
        if perf<40: self.cond=max(0,self.cond-1)
        if perf>=80: self.cond=min(4,self.cond+1); self.special_available=True
        self.hints+=hint
        self.fatigue=min(100,self.fatigue+FATIGUE_MATCH)
        self.match_results.append(("승" if win else "패",perf))
        return {"result":"승" if win else "패","perf":perf,"gains":gains,"hint":hint}
    def story_event(self, bonuses):
        g={}
        for s,v in bonuses.items(): g[s]=self.apply_gain(s,v)
        self.hints+=1
        return g
    def random_event(self):
        """40% 확률, 런당 최대 6회. 평균 효과: 스탯 +1.5 상당. (선택지 평균)"""
        if self.det or self.rand_events>=6 or self.rng.random()>0.40: return None
        self.rand_events+=1
        r=self.rng.random()
        if r<0.50:
            st=self.rng.choice(STATS); v=self.rng.choice([1,2,3]); self.apply_gain(st,v); return ("stat",st,v)
        elif r<0.75:
            d=self.rng.choice([-15,-10,10]); self.fatigue=max(0,min(100,self.fatigue+d)); return ("fatigue",d)
        else:
            d=self.rng.choice([1,1,-1]); self.cond=max(0,min(4,self.cond+d)); return ("cond",d)
    def reach(self):
        core=CORE3[self.pos]; allw=[s for s in STATS if self.pot[s]>self.init[s]]
        cr=sum(self.cur[s]-self.init[s] for s in core)/sum(self.pot[s]-self.init[s] for s in core)
        ar=sum(self.cur[s]-self.init[s] for s in allw)/sum(self.pot[s]-self.init[s] for s in allw)
        return cr,ar

EVAL_TURNS={4:62,8:72,12:80}   # 턴: 상대 강도(코어 평균 기준)
STORY_TURNS={2:{"mental":2},6:{"receive":2,"spike":1},10:{"spike":2,"mental":1}}   # 예시 카드 스토리 3회의 스탯 보너스(정답 선택 기준)

def roll_special(run):
    if not run.det and run.fatigue<=40 and run.cond>=3 and run.rng.random()<0.25: run.special_available=True
def policy_optimal(run):
    """가중 OVR 기대 상승 최대 훈련. 부상 위험이 임계 초과면 휴식. 특훈 가능하고 피로 낮으면 특훈."""
    roll_special(run)
    if run.special_available and run.fatigue<=45:
        run.special_available=False; return "special"
    best=None;bestv=-1
    for k in TRAINING:
        v=sum(POS_W[run.pos][s]*g for s,g in run.train_gains(k,preview=True).items())
        if v>bestv: best,bestv=k,v
    # 마지막 턴은 무조건 훈련(휴식 무의미), 그 외 위험>8%면 휴식
    if run.turn<12 and injury_p(run.fatigue,TRAIN_RISK[best])>0.08: return "rest"
    return best
def policy_random(run):
    roll_special(run)
    opts=list(TRAINING)+["rest"]+(["special"] if run.special_available else [])
    a=run.rng.choice(opts); run.special_available=False; return a
def policy_greedy_norest(run):
    roll_special(run)
    if run.special_available: run.special_available=False; return "special"
    best=None;bestv=-1
    for k in TRAINING:
        v=sum(POS_W[run.pos][s]*g for s,g in run.train_gains(k,preview=True).items())
        if v>bestv: best,bestv=k,v
    return best
def policy_safe(run):
    roll_special(run)
    if run.special_available: run.special_available=False; return "special"
    if run.fatigue>=35 and run.turn<12: return "rest"
    best=None;bestv=-1
    for k in TRAINING:
        v=sum(POS_W[run.pos][s]*g for s,g in run.train_gains(k,preview=True).items())
        if v>bestv: best,bestv=k,v
    return best
def policy_spike_only(run):
    run.special_available=False
    if run.fatigue>=55 and run.turn<12: return "rest"
    return "spike"

def simulate(policy, rng, det=False, support=0.0, story=True, card=CARD, forced_evals=None):
    run=Run(card,rng,deterministic=det,support=support)
    for t in range(1,13):
        run.turn=t
        a=policy(run)
        run.do_action(a)
        if story and t in STORY_TURNS: run.story_event(STORY_TURNS[t])
        elif story: run.random_event()
        if t in EVAL_TURNS:
            f=forced_evals.get(t) if forced_evals else None
            run.eval_match(EVAL_TURNS[t],forced=f)
    return run

def monte(policy, n=5000, seed=1, **kw):
    rng=random.Random(seed); res=[]
    for i in range(n): res.append(simulate(policy,rng,**kw))
    o=[ovr(r.cur,r.pos) for r in res]; g=Counter(grade(x) for x in o)
    cr=[r.reach()[0] for r in res]; ar=[r.reach()[1] for r in res]
    inj=sum(1 for r in res if r.injuries>0)/n; sev=sum(1 for r in res if r.severe>0)/n
    lost=statistics.mean(r.turns_lost for r in res)
    hints=statistics.mean(r.hints for r in res)
    return dict(ovr=statistics.mean(o), ovr_sd=statistics.pstdev(o), grades={k:g[k]/n for k in "SABCD"},
                core=statistics.mean(cr), all=statistics.mean(ar), inj=inj, sev=sev, lost=lost, hints=hints,
                ovr_p10=sorted(o)[n//10], ovr_p90=sorted(o)[n*9//10])

if __name__=="__main__":
    # ---- 1) 워크드 예시 (결정론) ----
    print("=== 워크드 예시: SSR OH, 기대값(난수 0), 스토리 이벤트 정답 선택, 평가전 결과 고정 ===")
    rng=random.Random(0)
    forced={4:(True,70),8:(False,66),12:(True,84)}
    plan=["spike","spike","receive","spike","rest","receive","serve","spike","rest","special","receive","serve"]
    run=Run(CARD,rng,deterministic=True)
    print("init OVR %.1f"%ovr(run.cur,"OH"))
    for t,a in enumerate(plan,1):
        run.turn=t
        if a=="special": run.special_available=True
        before=dict(run.cur)
        rec=run.do_action(a)
        extra={}
        if t in STORY_TURNS: extra["story"]=run.story_event(STORY_TURNS[t])
        if t in EVAL_TURNS: extra["eval"]=run.eval_match(EVAL_TURNS[t],forced=forced[t])
        gains=", ".join("%s+%.1f"%(s,g) for s,g in rec["gains"].items() if g>0.05)
        print("T%2d %-8s 피로 %3.0f->%3.0f 컨디션 %s->%s 부상p %4.1f%% | %s | %s | OVR %.1f"%(
            t,rec["action"],rec["fatigue_before"],rec["fatigue_after"],COND_NAME[rec["cond"]],COND_NAME[rec["cond_after"]],
            rec["inj_p"]*100,gains,{k:(v if k!="eval" else {kk:(round(vv,1) if isinstance(vv,float) else vv) for kk,vv in v.items() if kk!="gains"} | {"gains":{s:round(g,1) for s,g in v["gains"].items()}}) for k,v in extra.items()},ovr(run.cur,"OH")))
    print("final:", {s:round(run.cur[s],1) for s in STATS})
    print("final int:", {s:int(round(run.cur[s])) for s in STATS})
    print("OVR %.1f grade %s core_reach %.1f%% all_reach %.1f%% hints %d"%(ovr(run.cur,"OH"),grade(ovr(run.cur,"OH")),run.reach()[0]*100,run.reach()[1]*100,run.hints))

    # ---- 2) 정책별 몬테카를로 ----
    print("\n=== 정책별 몬테카를로 (n=5000, SSR OH 예시 카드) ===")
    for name,pol in [("최적 휴리스틱",policy_optimal),("랜덤",policy_random),("무휴식 몰빵",policy_greedy_norest),("과잉 휴식(피로35↑ 휴식)",policy_safe),("스파이크만",policy_spike_only)]:
        r=monte(pol)
        print("%-22s OVR %.1f(+%.1f)±%.1f (p10 %.1f / p90 %.1f) 등급 S %.0f%% A %.0f%% B %.0f%% C %.0f%% | 핵심도달 %.0f%% 전체도달 %.0f%% | 부상률 %.0f%% (중상 %.0f%%) 손실턴 %.2f 힌트 %.1f"%(
            name,r["ovr"],r["ovr"]-64.8,r["ovr_sd"],r["ovr_p10"],r["ovr_p90"],r["grades"]["S"]*100,r["grades"]["A"]*100,r["grades"]["B"]*100,r["grades"]["C"]*100,
            r["core"]*100,r["all"]*100,r["inj"]*100,r["sev"]*100,r["lost"],r["hints"]))
    print("\n--- 서포트 보정 +25% 적용 시 (최적) ---")
    r=monte(policy_optimal,support=0.25)
    print("OVR %.1f 등급 S %.0f%% A %.0f%% 핵심도달 %.0f%%"%(r["ovr"],r["grades"]["S"]*100,r["grades"]["A"]*100,r["core"]*100))

    # ---- 3) 다른 희귀도/포지션 ----
    print("\n=== 희귀도별 (최적 vs 랜덤) ===")
    SR_OH={"pos":"OH","stats":{"serve":52,"receive":56,"set":42,"spike":62,"block":48,"dig":52,"speed":58,"power":56,"stamina":54,"mental":50},
           "potential":{"serve":72,"receive":80,"set":52,"spike":86,"block":64,"dig":72,"speed":78,"power":78,"stamina":74,"mental":72}}
    R_OH={"pos":"OH","stats":{"serve":42,"receive":46,"set":34,"spike":52,"block":40,"dig":44,"speed":48,"power":46,"stamina":46,"mental":42},
          "potential":{"serve":60,"receive":68,"set":42,"spike":74,"block":54,"dig":62,"speed":66,"power":66,"stamina":64,"mental":62}}
    SSR_L={"pos":"L","stats":{"serve":30,"receive":72,"set":56,"spike":30,"block":30,"dig":70,"speed":70,"power":48,"stamina":64,"mental":60},
           "potential":{"serve":36,"receive":96,"set":70,"spike":36,"block":36,"dig":94,"speed":90,"power":60,"stamina":84,"mental":82}}
    SSR_MB={"pos":"MB","stats":{"serve":56,"receive":48,"set":44,"spike":66,"block":72,"dig":48,"speed":60,"power":70,"stamina":62,"mental":58},
            "potential":{"serve":74,"receive":62,"set":54,"spike":88,"block":98,"dig":62,"speed":80,"power":92,"stamina":82,"mental":80}}
    for label,c in [("SSR OH",CARD),("SR OH",SR_OH),("R OH",R_OH),("SSR L",SSR_L),("SSR MB",SSR_MB)]:
        for pname,pol in [("최적",policy_optimal),("랜덤",policy_random)]:
            r=monte(pol,n=3000,card=c)
            print("%-7s %-4s OVR %.1f 등급 S %.0f%% A %.0f%% B %.0f%% C %.0f%% D %.0f%% 핵심 %.0f%% 전체 %.0f%%"%(
                label,pname,r["ovr"],*(r["grades"][g]*100 for g in "SABCD"),r["core"]*100,r["all"]*100))
    # 부상 확률표
    print("\n=== 부상 확률표 (기본 위험 1.0) ===")
    for f in [40,50,60,70,80,90,100]: print(f, "%.1f%%"%(injury_p(f,1.0)*100), "스파이크(1.3) %.1f%%"%(injury_p(f,1.3)*100), "특훈(1.5) %.1f%%"%(injury_p(f,1.5)*100))
