"""
training-mode.md v0.2 수치 검증용 간이 시뮬레이터.

문서(부록 A)의 상수를 그대로 구현하고 다음을 출력한다.
  1) 12턴 워크드 예시 (기대값, 난수 0, 최적 정책이 고른 수순)
  2) 정책별 몬테카를로: OVR 평균·σ·등급 분포·부상률 (SSR OH 예시 카드, 서포터 없음)
  3) 휴식 임계값 스윕 (최적 정책 도출 근거)
  4) 레버 조합 비교표 (v0.1 규칙 → v0.2 규칙, 채택/기각 근거)
  5) 서포터 강도별 S 도달률
  6) 희귀도·포지션별 (안전 / 최적 / 랜덤)
실행: python3 tools/training-sim/train_sim.py   (--quick 로 n 축소)
모든 잡은 시드 고정이라 실행 순서·코어 수와 무관하게 같은 값이 나온다. 4코어 기준 약 25초.
"""
import random, statistics, sys, time, os
from collections import Counter
from multiprocessing import Pool

STATS = ["serve","receive","set","spike","block","dig","speed","power","stamina","mental"]
COND_NAME = {4:"절호조",3:"호조",2:"보통",1:"부진",0:"최악"}
ACTION_KO = {"serve":"서브","receive":"리시브","set":"토스","spike":"스파이크","block":"블로킹","rest":"휴식","special":"포지션 특훈"}

# ---------- 고정 상수 (v0.1과 동일) ----------
W_PRIMARY, W_SEC1, W_SEC2 = 1.0, 0.5, 0.25
APT = {"S":1.30,"A":1.15,"B":1.00,"C":0.70,"D":0.40}
POS_SCALE = {"S":1.0,"OH":1.0,"OP":1.0,"MB":1.0,"L":0.95}
FATIGUE_TRAIN = 20.0
FATIGUE_SPECIAL = 30.0
FATIGUE_MATCH = 12.0
FATIGUE_PASSIVE = 5.0
FATIGUE_REST = 45.0
FATIGUE_TREAT = 20.0
INJ_MAX, INJ_EXP = 0.40, 1.6
TRAIN_RISK = {"serve":0.8,"receive":1.0,"set":0.7,"spike":1.3,"block":1.2,"special":1.5}
SPECIAL_BASE_MULT = 1.5
SPECIAL_W = (1.0, 0.7, 0.5)
RANDOM_EVENT_P, RANDOM_EVENT_CAP = 0.40, 6
SUP_EVENT_TURNS, SUP_EVENT_P, SUP_EVENT_CAP = (5, 9), 0.5, 2

# ---------- 레버 (v0.2 채택값 = DEFAULT, v0.1 = V01) ----------
DEFAULT_CFG = dict(
    base=4.6,                      # 기본 상승치 B. v0.1 5.0 (레버 h)
    diminish_full=20.0, diminish_min=0.25,
    rand_eps=0.25,
    # 강도 곡선: 콜드 <30 / 적정 30~44 / 핫존 45~79 / 과열 80+
    cold_hi=30, cold_mult=0.85,    # 레버 d3. v0.1 없음
    hot_lo=45, hot_hi=80, hot_mult=1.50,   # 레버 a'. v0.1 50~79 ×1.10
    overheat_mult=0.85,
    combo_step=0.05, combo_cap=0.15,       # 레버 b. 연속 훈련 +5/+10/+15%. v0.1 없음
    special_zone="hot", special_p=0.25,    # 레버 c. 특훈 등장 조건 핫존 & 호조↑. v0.1 피로≤40 & 호조↑
    # 휴식
    rest_amount=FATIGUE_REST, rest_mental=1.0,
    rest_cond_up=0.70, rest_deep_at=50, rest_cond_up_shallow=0.30,   # 레버 d2. 피로<50 '얕은 휴식'은 컨디션+1 30%
    # 컨디션
    cond_mult={4:1.30,3:1.10,2:1.00,1:0.85,0:0.60},   # 레버 e. v0.1 1.25/0.65
    drift_mid=(0.15,0.70,0.15),    # 훈련 턴 드리프트 (+1/유지/−1): 피로 < 60
    drift_hot=(0.15,0.70,0.15),    # 피로 60~79. 레버 f. v0.1 (0.05,0.60,0.35)
    drift_over=(0.0,0.40,0.60),    # 피로 >= 80
    event_branch=0.50,             # 레버 e. 랜덤 스탯 이벤트 중 성공/실패 분기 비중. v0.1 0.30
    # 부상
    inj_start=45, inj_exp=INJ_EXP, # 레버 f. 부상 시작 피로. v0.1 40
    reinjury_mult=2.0,             # 레버 g. 부상 이력 시 남은 캠프 동안 부상 확률 배수. v0.1 없음
    severe_ratio=0.30, treat_light=1, treat_severe=2,
    light_loss=3,                  # 레버 g. 경상: speed/power/stamina −3. v0.1 0
    severe_all_loss=3, severe_loss=0,   # 레버 g. 중상: 전 스탯 −3. v0.1 신체 3스탯 −3
    # 서포트
    support_cap=0.20,              # 훈련 1종당 서포트 보정 합 상한. v0.1 0.50(코치 카드 가정)
)
V01_CFG = dict(DEFAULT_CFG, base=5.0, cold_hi=0, cold_mult=1.0, hot_lo=50, hot_mult=1.10, combo_step=0.0, combo_cap=0.0,
               special_zone="low", rest_deep_at=0, rest_cond_up_shallow=0.70,
               cond_mult={4:1.25,3:1.10,2:1.00,1:0.85,0:0.65}, drift_hot=(0.05,0.60,0.35), event_branch=0.30,
               inj_start=40, reinjury_mult=1.0, light_loss=0, severe_all_loss=0, severe_loss=3, support_cap=0.50)
assert DEFAULT_CFG["severe_all_loss"]==3 and DEFAULT_CFG["light_loss"]==3
CFG = dict(DEFAULT_CFG)

# 정책 파라미터 (12.3절)
SAFE_REST_AT = 35          # 안전: 피로 >= 35면 휴식 (부상 0%)
SAFE_SPECIAL_MAX_P = 0.05  # 안전: 특훈은 부상률 5% 이하만 수락
OPT_INJ_THRESH = 0.10      # 최적: 최선 훈련의 부상 배지 > 10%면 휴식 (3절 스윕으로 결정)
OPT_SPECIAL_MAX_P = 0.20
PUSH_INJ_THRESH = 0.20     # 푸시(도박형): 배지 20%까지 강행
PUSH_SPECIAL_MAX_P = 0.30
EV_LOSS_W = 2.0            # 훈련 선택 시 부상 1회의 가중 손실 추정치(OVR 단위)

TRAINING = {"serve":("serve","power","mental"),"receive":("receive","dig","stamina"),"set":("set","mental","speed"),
            "spike":("spike","power","stamina"),"block":("block","speed","power")}
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
GRADE_TH = [("S",80),("A",74),("B",66),("C",55),("D",-1)]
for p in POS_W: assert abs(sum(POS_W[p].values())-1)<1e-9, p

# ---------- 카드 ----------
CARD = {"name":"SSR OH 예시","pos":"OH","club":"t01",
    "stats":    {"serve":62,"receive":66,"set":50,"spike":72,"block":58,"dig":60,"speed":68,"power":66,"stamina":64,"mental":60},
    "potential":{"serve":82,"receive":90,"set":60,"spike":98,"block":74,"dig":80,"speed":88,"power":88,"stamina":84,"mental":82}}
SR_OH={"pos":"OH","club":"t02","stats":{"serve":52,"receive":56,"set":42,"spike":62,"block":48,"dig":52,"speed":58,"power":56,"stamina":54,"mental":50},
       "potential":{"serve":72,"receive":80,"set":52,"spike":86,"block":64,"dig":72,"speed":78,"power":78,"stamina":74,"mental":72}}
R_OH={"pos":"OH","club":"t03","stats":{"serve":42,"receive":46,"set":34,"spike":52,"block":40,"dig":44,"speed":48,"power":46,"stamina":46,"mental":42},
      "potential":{"serve":60,"receive":68,"set":42,"spike":74,"block":54,"dig":62,"speed":66,"power":66,"stamina":64,"mental":62}}
SSR_L={"pos":"L","club":"t02","stats":{"serve":30,"receive":72,"set":56,"spike":30,"block":30,"dig":70,"speed":70,"power":48,"stamina":64,"mental":60},
       "potential":{"serve":36,"receive":96,"set":70,"spike":36,"block":36,"dig":94,"speed":90,"power":60,"stamina":84,"mental":82}}
SSR_MB={"pos":"MB","club":"t03","stats":{"serve":56,"receive":48,"set":44,"spike":66,"block":72,"dig":48,"speed":60,"power":70,"stamina":62,"mental":58},
        "potential":{"serve":74,"receive":62,"set":54,"spike":88,"block":98,"dig":62,"speed":80,"power":92,"stamina":82,"mental":80}}
SSR_S={"pos":"S","club":"t05","stats":{"serve":58,"receive":58,"set":72,"spike":50,"block":54,"dig":58,"speed":66,"power":54,"stamina":62,"mental":66},
       "potential":{"serve":76,"receive":74,"set":98,"spike":62,"block":70,"dig":74,"speed":88,"power":68,"stamina":80,"mental":90}}
SSR_OP={"pos":"OP","club":"t04","stats":{"serve":64,"receive":48,"set":40,"spike":74,"block":58,"dig":48,"speed":62,"power":70,"stamina":62,"mental":58},
        "potential":{"serve":86,"receive":60,"set":48,"spike":98,"block":76,"dig":60,"speed":80,"power":92,"stamina":82,"mental":80}}

# ---------- 서포터 (9절, B안: 로스터 졸업 인스턴스) ----------
RIVALS = {("t01","t05"),("t02","t06"),("t03","t04")}   # world.md 3절 라이벌 구도
SUP_STAT_BASE, SUP_STAT_DIV, SUP_TRAIN_CAP_EACH = 60, 800, 0.06   # 훈련 보정 = (주스탯−60)/800, 서포터당 ≤ +6%p (스탯 100 → +5%p)
SUP_POS_MATCH = 0.02        # 포지션 일치: 전 훈련 +2%p
SUP_SAME_CLUB = 0.02        # 동문(같은 원소속): 전 훈련 +2%p
SUP_RIVAL_HOT = 0.05        # 라이벌 구단 선배: 핫존 훈련에만 +5%p (푸시 유도)
SUP_INJ_DIV, SUP_INJ_CAP_EACH, SUP_INJ_FLOOR = 300, 0.10, 0.80    # 부상 방지 = (stamina−60)/300, 총 하한 ×0.80
SUP_COND_DIV, SUP_COND_CAP_EACH, SUP_COND_FLOOR = 200, 0.12, 0.65 # 컨디션 안정 = (mental−60)/200, 하락 확률 총 하한 ×0.65
SUP_SPECIAL_S, SUP_SPECIAL_A, SUP_SPECIAL_CAP = 0.03, 0.02, 0.06  # 특훈 등장 +3%p(S 등급 서포터) / +2%p(A), 합 ≤ +6%p

def mk_sup(name,pos,club,**st):
    s={k:60 for k in STATS}; s.update(st); return {"name":name,"pos":pos,"club":club,"stats":s}
SUP_SR_OH_B  = mk_sup("SR OH B등급","OH","t04",serve=70,receive=76,spike=84,dig=64,power=74,stamina=66,mental=64)
SUP_SSR_OH_A = mk_sup("SSR OH A등급","OH","t02",serve=78,receive=86,spike=95,dig=68,power=80,stamina=72,mental=70)
SUP_SSR_MB_A = mk_sup("SSR MB A등급","MB","t03",serve=66,spike=84,block=95,power=88,speed=72,stamina=74,mental=68)
SUP_SSR_OH_S = mk_sup("SSR OH S등급(동문)","OH","t01",serve=82,receive=90,spike=98,dig=70,power=84,stamina=78,mental=76)
SUP_SSR_MB_S = mk_sup("SSR MB S등급","MB","t03",serve=70,spike=88,block=98,power=92,speed=76,stamina=78,mental=74)
SUP_SSR_L_S  = mk_sup("SSR L S등급(라이벌)","L","t05",receive=96,dig=94,set=66,speed=90,stamina=80,mental=80)
SUPPORT_LEVELS = [
    ("없음", []),
    ("초반: SR B등급 1명", [SUP_SR_OH_B]),
    ("중반: SSR A등급 2명", [SUP_SSR_OH_A, SUP_SSR_MB_A]),
    ("풀세팅: SSR S등급 3명(동문+라이벌)", [SUP_SSR_OH_S, SUP_SSR_MB_S, SUP_SSR_L_S]),
]

class Support:
    """트레이니 카드 + 서포터 목록 → 수식에 꽂히는 보정치 (9.3절)."""
    def __init__(self, card, sups, cap=None):
        cap = CFG["support_cap"] if cap is None else cap
        self.n=len(sups); self.names=[s["name"] for s in sups]
        self.train={t:0.0 for t in TRAINING}; self.hot_extra=0.0
        inj=0.0; cond=0.0; sp=0.0; self.event_stats=[]
        div=CFG.get("sup_div",SUP_STAT_DIV)
        for s in sups:
            st=s["stats"]
            for t,(main,_,_) in TRAINING.items():
                self.train[t]+=min(SUP_TRAIN_CAP_EACH, max(0.0,st[main]-SUP_STAT_BASE)/div)
            if s["pos"]==card["pos"]:
                for t in TRAINING: self.train[t]+=SUP_POS_MATCH
            if s["club"]==card["club"]:
                for t in TRAINING: self.train[t]+=SUP_SAME_CLUB
            if (s["club"],card["club"]) in RIVALS or (card["club"],s["club"]) in RIVALS:
                self.hot_extra+=SUP_RIVAL_HOT
            inj+=min(SUP_INJ_CAP_EACH, max(0.0,st["stamina"]-SUP_STAT_BASE)/SUP_INJ_DIV)
            cond+=min(SUP_COND_CAP_EACH, max(0.0,st["mental"]-SUP_STAT_BASE)/SUP_COND_DIV)
            o=ovr(st,s["pos"]); sp+= CFG.get("sup_special_s",SUP_SPECIAL_S) if o>=80 else (CFG.get("sup_special_a",SUP_SPECIAL_A) if o>=74 else 0.0)
            self.event_stats.append(max(TRAINING, key=lambda t: st[TRAINING[t][0]]))  # 시그니처 훈련
        for t in self.train: self.train[t]=min(cap,self.train[t])
        self.injury_mult=max(CFG.get("sup_inj_floor",SUP_INJ_FLOOR),1-inj)
        self.cond_down_mult=max(CFG.get("sup_cond_floor",SUP_COND_FLOOR),1-cond)
        self.special_bonus=min(CFG.get("sup_special_cap",SUP_SPECIAL_CAP),sp)
    def summary(self):
        return "훈련보정 "+" ".join("%s+%.1f%%"%(ACTION_KO[t],v*100) for t,v in self.train.items())+ \
               " | 핫존 +%.0f%%p 부상×%.2f 컨디션하락×%.2f 특훈+%.0f%%p"%(self.hot_extra*100,self.injury_mult,self.cond_down_mult,self.special_bonus*100)

def recommend_supporters(card, roster, k=3):
    """초보용 자동 추천(11.1절): 핵심 3스탯 훈련 보정 합 + 인연·부상 방지 가산이 큰 순으로 k명 (탐욕)."""
    core_trainings=[t for t in TRAINING if TRAINING[t][0] in CORE3[card["pos"]]]
    def score(s):
        one=Support(card,[s],cap=9)
        return sum(one.train[t] for t in core_trainings)+one.hot_extra*0.5+(1-one.injury_mult)*0.5
    return sorted(roster,key=score,reverse=True)[:k]

# ---------- 기본 함수 ----------
def ovr(stats,pos): return POS_SCALE[pos]*sum(POS_W[pos][s]*stats[s] for s in STATS)
def grade(o):
    for g,t in GRADE_TH:
        if o>=t: return g
def diminish(cur,pot):
    rem=pot-cur
    if rem<=0: return 0.0
    return max(CFG["diminish_min"],min(1.0,rem/CFG["diminish_full"]))
def injury_p(fatigue,risk,mult=1.0):
    st=CFG["inj_start"]
    if fatigue<st: return 0.0
    return min(1.0,INJ_MAX*((fatigue-st)/(100-st))**CFG["inj_exp"]*risk*mult)
def fatigue_gain(base,stamina): return base*(1-(stamina-60)/250)
def in_hot(f): return CFG["hot_lo"]<=f<CFG["hot_hi"]
def zone_mult(f):
    """강도 곡선(4.1절 Z): 콜드 / 적정 / 핫존 / 과열"""
    if f>=CFG["hot_hi"]: return CFG["overheat_mult"]
    if f>=CFG["hot_lo"]: return CFG["hot_mult"]
    if f<CFG["cold_hi"]: return CFG["cold_mult"]
    return 1.0
def zone_name(f):
    if f>=CFG["hot_hi"]: return "과열"
    if f>=CFG["hot_lo"]: return "핫존"
    if f<CFG["cold_hi"]: return "콜드"
    return "적정"

EVAL_TURNS={4:62,8:72,12:80}
STORY_TURNS={2:{"mental":2},6:{"receive":2,"spike":1},10:{"spike":2,"mental":1}}

class Run:
    def __init__(self, card, rng, deterministic=False, support=None, flat_support=0.0):
        self.card=card; self.pos=card["pos"]; self.rng=rng; self.det=deterministic
        self.cur=dict(card["stats"]); self.pot=card["potential"]; self.init=dict(card["stats"])
        self.fatigue=0.0; self.cond=2; self.turn=1; self.combo=0
        self.sup=support; self.flat=flat_support
        self.injured_turns=0; self.injuries=0; self.severe=0; self.turns_lost=0; self.injury_turn=None
        self.hints=0; self.rand_events=0; self.sup_events=0; self.rests=0; self.hot_trains=0; self.cond_acc=0.0; self.trains=0
        self.log=[]; self.special_available=False; self.match_results=[]; self.shallow_rest=False
    def eps(self): return 0.0 if self.det else self.rng.uniform(-CFG["rand_eps"],CFG["rand_eps"])
    def apply_gain(self,stat,raw):
        g=min(raw,max(0.0,self.pot[stat]-self.cur[stat])); self.cur[stat]+=g; return g
    def inj_mult(self):
        m=self.sup.injury_mult if self.sup else 1.0
        if self.injuries>0: m*=CFG["reinjury_mult"]
        return m
    def base_mult(self):
        """4.1절 M의 훈련 종류와 무관한 부분 = 컨디션 × 강도 곡선 × (1+콤보)"""
        return CFG["cond_mult"][self.cond]*zone_mult(self.fatigue)*(1+min(CFG["combo_cap"],CFG["combo_step"]*self.combo))
    def sup_mult(self,kind):
        """(1+서포트): 훈련 종류별 보정 + 라이벌 핫존 가산, 합계 상한"""
        if not self.sup and self.flat==0.0: return 1.0
        sup=self.flat
        if self.sup:
            if kind=="special": sup+=max(self.sup.train[t] for t in TRAINING if TRAINING[t][0] in CORE3[self.pos])
            else: sup+=self.sup.train[kind]
            if in_hot(self.fatigue): sup+=self.sup.hot_extra
        return 1+min(CFG["support_cap"],sup)
    def multiplier(self,kind): return self.base_mult()*self.sup_mult(kind)
    def train_gains(self,kind,preview=False):
        out={}; cm=self.multiplier(kind)
        if kind=="special":
            for stat,w in zip(CORE3[self.pos],SPECIAL_W):
                out[stat]=CFG["base"]*SPECIAL_BASE_MULT*w*diminish(self.cur[stat],self.pot[stat])*cm
        else:
            apt=APT[POS_APT[self.pos][kind]]
            for stat,w in zip(TRAINING[kind],(W_PRIMARY,W_SEC1,W_SEC2)):
                out[stat]=CFG["base"]*w*apt*diminish(self.cur[stat],self.pot[stat])*cm
        if not preview:
            e=self.eps(); out={k:v*(1+e) for k,v in out.items()}
        return out
    def weighted_previews(self):
        """훈련 5종의 OVR 가중 기대 상승(ε=0). dict 생성 없이 한 번에 계산."""
        bm=self.base_mult()*CFG["base"]; pw=POS_W[self.pos]; apt=POS_APT[self.pos]; cur=self.cur; pot=self.pot; out={}
        for k,(s0,s1,s2) in TRAINING.items():
            a=APT[apt[k]]*bm*self.sup_mult(k)
            out[k]=a*(pw[s0]*diminish(cur[s0],pot[s0])+0.5*pw[s1]*diminish(cur[s1],pot[s1])+0.25*pw[s2]*diminish(cur[s2],pot[s2]))
        return out
    def weighted_preview(self,kind): return self.weighted_previews()[kind]
    def best_training(self):
        wp=self.weighted_previews(); return max(wp,key=wp.get)
    def best_training_ev(self,loss_w=EV_LOSS_W):
        """부상 배지를 감안한 기대값 최대 훈련: gain×(1−p) − p×loss_w. 핫존에서 저위험 훈련(서브·토스)으로 갈아타는 근거."""
        wp=self.weighted_previews(); im=self.inj_mult(); f=self.fatigue
        def ev(k):
            p=injury_p(f,TRAIN_RISK[k],im); return wp[k]*(1-p)-p*loss_w
        return max(TRAINING,key=ev)
    def do_action(self,action,forced_injury=None):
        rec={"turn":self.turn,"action":action,"fatigue_before":self.fatigue,"cond":self.cond,"gains":{},"injury":None,"inj_p":0.0,"combo":self.combo,"zone":zone_name(self.fatigue)}
        if self.injured_turns>0:
            rec["action"]="치료"; self.injured_turns-=1; self.turns_lost+=1
            self.fatigue=max(0,self.fatigue-FATIGUE_TREAT); self.combo=0
        elif action=="rest":
            self.rests+=1; self.combo=0; self.shallow_rest=self.fatigue<CFG["rest_deep_at"]
            self.fatigue=max(0,self.fatigue-CFG["rest_amount"])
            if CFG["rest_mental"]>0: rec["gains"]["mental"]=self.apply_gain("mental",CFG["rest_mental"])
        else:
            p=injury_p(self.fatigue,TRAIN_RISK[action],self.inj_mult()); rec["inj_p"]=p
            hit=forced_injury if forced_injury is not None else ((not self.det) and self.rng.random()<p)
            if hit:
                self.injuries+=1; self.combo=0
                if self.injury_turn is None: self.injury_turn=self.turn
                if self.rng.random()<CFG["severe_ratio"]:
                    self.severe+=1; self.injured_turns=CFG["treat_severe"]; self.cond=0
                    for s in ["speed","power","stamina"]: self.cur[s]=max(0,self.cur[s]-CFG["severe_loss"])
                    for s in STATS: self.cur[s]=max(0,self.cur[s]-CFG["severe_all_loss"])
                    rec["injury"]="중상"
                else:
                    self.injured_turns=CFG["treat_light"]; self.cond=max(0,self.cond-1); rec["injury"]="경상"
                    for s in ["speed","power","stamina"]: self.cur[s]=max(0,self.cur[s]-CFG["light_loss"])
            else:
                if in_hot(self.fatigue): self.hot_trains+=1
                self.trains+=1; self.cond_acc+=CFG["cond_mult"][self.cond]
                for s,g in self.train_gains(action).items(): rec["gains"][s]=self.apply_gain(s,g)
                fb=FATIGUE_SPECIAL if action=="special" else FATIGUE_TRAIN
                self.fatigue=min(100,self.fatigue+fatigue_gain(fb,self.cur["stamina"]))
                if action=="special": self.hints+=1
                self.combo+=1
        if action!="rest" and rec["action"]!="치료": self.fatigue=max(0,self.fatigue-FATIGUE_PASSIVE)
        if rec["injury"] is None and rec["action"]!="치료": self.drift_condition(action=="rest")
        rec["fatigue_after"]=self.fatigue; rec["cond_after"]=self.cond
        self.log.append(rec); return rec
    def drift_condition(self,rested):
        if self.det:
            if rested and not self.shallow_rest: self.cond=min(4,self.cond+1)
            elif (not rested) and self.fatigue>=80: self.cond=max(0,self.cond-1)
            return
        r=self.rng.random()
        if rested: up,down=((CFG["rest_cond_up_shallow"] if self.shallow_rest else CFG["rest_cond_up"]),0.0)
        elif self.fatigue<60: up,_,down=CFG["drift_mid"]
        elif self.fatigue<80: up,_,down=CFG["drift_hot"]
        else: up,_,down=CFG["drift_over"]
        if self.sup: down*=self.sup.cond_down_mult
        if r<up: self.cond=min(4,self.cond+1)
        elif r<up+down: self.cond=max(0,self.cond-1)
    def eval_match(self,opp,forced=None):
        if self.injured_turns>0 and forced is None:
            self.match_results.append(("결장",0)); return {"result":"결장"}
        core=statistics.mean(self.cur[s] for s in CORE3[self.pos])
        if forced: win,perf=forced
        else:
            perf=max(0,min(100,50+(core-opp)*1.5+self.rng.gauss(0,12)))
            win=self.rng.random()<1/(1+2.718**(-(core-opp)/8))
        gains={}
        bonus,hint=(2,2) if perf>=80 else ((1,1) if perf>=60 else (0,0))
        for s in CORE3[self.pos]: gains[s]=self.apply_gain(s,bonus)
        if win: hint+=1
        else: gains["mental"]=self.apply_gain("mental",1)
        if perf<40: self.cond=max(0,self.cond-1)
        if perf>=80: self.cond=min(4,self.cond+1); self.special_available=True
        self.hints+=hint; self.fatigue=min(100,self.fatigue+FATIGUE_MATCH)
        self.match_results.append(("승" if win else "패",perf))
        return {"result":"승" if win else "패","perf":perf,"gains":gains,"hint":hint,"bonus":bonus}
    def story_event(self,bonuses):
        g={s:self.apply_gain(s,v) for s,v in bonuses.items()}; self.hints+=1; return g
    def supporter_event(self):
        """선배 이벤트(9.4절): T5/T9, 서포터 있을 때 50%, 런당 ≤2. 서포터 시그니처 스탯 +2, 힌트 +1."""
        if self.det or not self.sup or self.sup.n==0 or self.sup_events>=SUP_EVENT_CAP: return None
        if self.rng.random()>=SUP_EVENT_P: return None
        self.sup_events+=1
        t=self.rng.choice(self.sup.event_stats); st=TRAINING[t][0]
        self.apply_gain(st,CFG.get("sup_event_gain",2)); self.hints+=1; return ("sup",st)
    def random_event(self):
        if self.det or self.rand_events>=RANDOM_EVENT_CAP or self.rng.random()>RANDOM_EVENT_P: return None
        self.rand_events+=1; r=self.rng.random()
        if r<0.50:
            st=self.rng.choice(STATS)
            if self.rng.random()<CFG["event_branch"]:      # 성공/실패 분기: 성공 65% +3, 실패 컨디션 −1
                if self.rng.random()<0.65: self.apply_gain(st,3); return ("stat+",st,3)
                self.cond=max(0,self.cond-1); return ("fail",st)
            v=self.rng.choice([1,2,3]); self.apply_gain(st,v); return ("stat",st,v)
        elif r<0.75:
            d=self.rng.choice([-15,-10,10]); self.fatigue=max(0,min(100,self.fatigue+d)); return ("fatigue",d)
        else:
            d=self.rng.choice([1,1,-1]); self.cond=max(0,min(4,self.cond+d)); return ("cond",d)
    def reach(self):
        core=CORE3[self.pos]; allw=[s for s in STATS if self.pot[s]>self.init[s]]
        cr=sum(self.cur[s]-self.init[s] for s in core)/sum(self.pot[s]-self.init[s] for s in core)
        ar=sum(self.cur[s]-self.init[s] for s in allw)/sum(self.pot[s]-self.init[s] for s in allw)
        return cr,ar

# ---------- 특훈 등장 (3.4절) ----------
def roll_special(run):
    if run.det or run.special_available: return
    zone_ok = (run.fatigue<=40) if CFG["special_zone"]=="low" else in_hot(run.fatigue)
    p=CFG["special_p"]+(run.sup.special_bonus if run.sup else 0.0)
    if zone_ok and run.cond>=3 and run.rng.random()<p: run.special_available=True

# ---------- 정책 (12.3절) ----------
def _threshold_policy(run, thresh, special_max_p):
    """최선 훈련(부상 감안 EV)의 부상 배지가 thresh를 넘으면 휴식(T12 제외). 특훈은 배지가 special_max_p 이하일 때 수락."""
    roll_special(run)
    if run.special_available:
        if injury_p(run.fatigue,TRAIN_RISK["special"],run.inj_mult())<=special_max_p:
            run.special_available=False; return "special"
        elif run.turn==12: run.special_available=False
    best=run.best_training_ev()
    if run.turn<12 and injury_p(run.fatigue,TRAIN_RISK[best],run.inj_mult())>thresh: return "rest"
    return best
def make_safe_policy(rest_at):
    def p(run):
        roll_special(run)
        if run.special_available and injury_p(run.fatigue,TRAIN_RISK["special"],run.inj_mult())<=SAFE_SPECIAL_MAX_P:
            run.special_available=False; return "special"
        if run.fatigue>=rest_at and run.turn<12: return "rest"
        return run.best_training_ev()
    return p
policy_safe = make_safe_policy(SAFE_REST_AT)
def policy_optimal(run): return _threshold_policy(run,OPT_INJ_THRESH,OPT_SPECIAL_MAX_P)
def policy_push(run): return _threshold_policy(run,PUSH_INJ_THRESH,PUSH_SPECIAL_MAX_P)
def policy_random(run):
    roll_special(run)
    opts=list(TRAINING)+["rest"]+(["special"] if run.special_available else [])
    a=run.rng.choice(opts); run.special_available=False; return a
def policy_greedy_norest(run):
    roll_special(run)
    if run.special_available: run.special_available=False; return "special"
    return run.best_training()
def policy_spike_only(run):
    run.special_available=False
    if run.fatigue>=55 and run.turn<12: return "rest"
    return "spike"
POLICIES={"safe":policy_safe,"optimal":policy_optimal,"push":policy_push,
          "random":policy_random,"norest":policy_greedy_norest,"spike":policy_spike_only}
def make_threshold_policy(th):
    def p(run): return _threshold_policy(run,th,OPT_SPECIAL_MAX_P)
    return p

# ---------- 시뮬 ----------
def simulate(policy,rng,det=False,support=None,flat_support=0.0,story=True,card=CARD,forced_evals=None):
    run=Run(card,rng,deterministic=det,support=support,flat_support=flat_support)
    for t in range(1,13):
        run.turn=t
        run.do_action(policy(run))
        if story and t in STORY_TURNS: run.story_event(STORY_TURNS[t])
        elif story:
            if not (t in SUP_EVENT_TURNS and run.supporter_event()): run.random_event()
        if t in EVAL_TURNS:
            run.eval_match(EVAL_TURNS[t],forced=(forced_evals or {}).get(t))
    return run

def _job(spec):
    """(cfg, policy_name | threshold | ('safe',rest_at), n, seed, card, sups, flat) -> 집계 dict. 워커에서 실행."""
    cfg,pol,n,seed,card,sups,flat=spec
    CFG.clear(); CFG.update(cfg)
    if isinstance(pol,str): policy=POLICIES[pol]
    elif isinstance(pol,tuple): policy=make_safe_policy(pol[1])
    else: policy=make_threshold_policy(pol)
    sup=Support(card,sups) if sups else None
    rng=random.Random(seed); res=[simulate(policy,rng,support=sup,flat_support=flat,card=card) for _ in range(n)]
    CFG.clear(); CFG.update(DEFAULT_CFG)
    o=[ovr(r.cur,r.pos) for r in res]; g=Counter(grade(x) for x in o)
    inj=[r for r in res if r.injuries>0]; noinj=[r for r in res if r.injuries==0]
    sev=[r for r in inj if r.severe>0]; light=[r for r in inj if r.severe==0]
    so=sorted(o)
    return dict(ovr=statistics.mean(o),sd=statistics.pstdev(o),grades={k:g[k]/n for k in "SABCD"},
                core=statistics.mean(r.reach()[0] for r in res),all=statistics.mean(r.reach()[1] for r in res),
                inj=len(inj)/n,sev=sum(1 for r in res if r.severe>0)/n,lost=statistics.mean(r.turns_lost for r in res),
                hints=statistics.mean(r.hints for r in res),rests=statistics.mean(r.rests for r in res),
                hot=statistics.mean(r.hot_trains for r in res),trains=statistics.mean(r.trains for r in res),
                condavg=statistics.mean(r.cond_acc/max(1,r.trains) for r in res),
                ovr_inj=statistics.mean(ovr(r.cur,r.pos) for r in inj) if inj else float("nan"),
                ovr_noinj=statistics.mean(ovr(r.cur,r.pos) for r in noinj) if noinj else float("nan"),
                ovr_light=statistics.mean(ovr(r.cur,r.pos) for r in light) if light else float("nan"),
                ovr_severe=statistics.mean(ovr(r.cur,r.pos) for r in sev) if sev else float("nan"),
                p10=so[n//10],p90=so[n*9//10],sup_events=statistics.mean(r.sup_events for r in res))

def run_jobs(specs,pool): return pool.map(_job,specs)

def f1(x): return "—" if x!=x else "%.1f"%x
def fmt_policy(name,r,base_ovr):
    return "| %s | %.1f (+%.1f) | %.1f | %.1f / %.1f | S %.0f / A %.0f / B %.0f | %.0f%% / %.0f%% | %.0f%% (%.0f%%) | %s / %s / %s | %.1f / %.1f / %.1f | %.1f |"%(
        name,r["ovr"],r["ovr"]-base_ovr,r["sd"],r["p10"],r["p90"],*(r["grades"][k]*100 for k in "SAB"),
        r["core"]*100,r["all"]*100,r["inj"]*100,r["sev"]*100,f1(r["ovr_noinj"]),f1(r["ovr_light"]),f1(r["ovr_severe"]),r["rests"],r["hot"],r["trains"],r["hints"])
POLICY_HEADER=("| 정책 | OVR (초기 64.8 대비) | σ | p10 / p90 | 등급 % | 핵심 / 전체 도달 | 부상률 (중상) | 무부상 / 경상 / 중상 OVR | 휴식 / 핫존 훈련 / 훈련 수 | 힌트 |\n"
               "|---|---|---|---|---|---|---|---|---|---|")

# ---------- 워크드 예시 (4.4절) ----------
def worked_example():
    print("=== 1) 워크드 예시: SSR OH, 기대값(난수 0), 서포터 없음, 최적 정책 수순, 스토리 정답 선택, 평가전 고정(승70/승82 MVP/승86), 부상 미발생 ===")
    forced={4:(True,70),8:(True,82),12:(True,86)}
    def play(inj_turn=None,sev=False):
        rng=random.Random(0); run=Run(CARD,rng,deterministic=True); rows=[]
        for t in range(1,13):
            run.turn=t; a=policy_optimal(run); extra=[]
            if t==inj_turn:
                run.rng=type("R",(),{"random":lambda self: 0.0 if sev else 0.99})()
                rec=run.do_action(a,forced_injury=True); run.rng=rng
            else: rec=run.do_action(a)
            if t in STORY_TURNS:
                g=run.story_event(STORY_TURNS[t]); extra.append("스토리#%d: "%(list(STORY_TURNS).index(t)+1)+", ".join("%s +%.1f"%(s,v) for s,v in g.items()))
            if t in EVAL_TURNS:
                e=run.eval_match(EVAL_TURNS[t],forced=None if run.injured_turns>0 else forced[t])
                if e["result"]=="결장": extra.append("**%s차 평가전 결장**"%(list(EVAL_TURNS).index(t)+1))
                else: extra.append("**%s차 평가전 %s, 활약 %d%s** → 핵심3 +%d, 힌트 +%d"%(list(EVAL_TURNS).index(t)+1,e["result"],e["perf"]," (MVP)" if e["perf"]>=80 else "",e["bonus"],e["hint"]))
            rows.append((a,rec,extra,dict(run.cur),ovr(run.cur,"OH")))
        return run,rows
    run,rows=play()
    print("init OVR %.1f"%ovr(CARD["stats"],"OH"))
    print("| 턴 | 행동 | 피로 전→후 | 구간 / 콤보 | 컨디션 | 부상p | 훈련 상승 | 이벤트 / 평가전 | "+" | ".join(STATS)+" | OVR |")
    print("|---|---|---|---|---|---|---|---|"+"---|"*len(STATS)+"---|")
    print("| T0 | 초기 | — | — | 보통 | — | — | — | "+" | ".join(str(CARD["stats"][s]) for s in STATS)+" | %.1f |"%ovr(CARD["stats"],"OH"))
    for t,(a,rec,extra,cur,o) in enumerate(rows,1):
        zone=rec["zone"]+(" ×%.2f"%zone_mult(rec["fatigue_before"]) if zone_mult(rec["fatigue_before"])!=1.0 else "")
        if rec["combo"]>0 and a!="rest": zone+=" / 콤보 +%d%%"%(min(CFG["combo_cap"],CFG["combo_step"]*rec["combo"])*100)
        if a=="rest": zone="휴식(%s)"%("얕음" if rec["fatigue_before"]<CFG["rest_deep_at"] else "깊음")
        gains=", ".join("%s +%.1f"%(s,g) for s,g in rec["gains"].items() if g>0.05)
        print("| T%d | %s | %.0f→%.0f | %s | %s%s | %.1f%% | %s | %s | "%(t,ACTION_KO[a],rec["fatigue_before"],rec["fatigue_after"],zone,
              COND_NAME[rec["cond"]],("→"+COND_NAME[rec["cond_after"]]) if rec["cond_after"]!=rec["cond"] else "",
              rec["inj_p"]*100,gains or "mental +1.0","; ".join(extra) or "—")+" | ".join("%.1f"%cur[s] for s in STATS)+" | %.1f |"%o)
    print("final int:",{s:int(round(run.cur[s])) for s in STATS})
    print("OVR %.1f grade %s core_reach %.0f%% all_reach %.0f%% hints %d rests %d hot_trains %d"%(ovr(run.cur,"OH"),grade(ovr(run.cur,"OH")),run.reach()[0]*100,run.reach()[1]*100,run.hints,run.rests,run.hot_trains))
    for label,it,sev in [("T8 경상",8,False),("T8 중상",8,True),("T11 경상",11,False),("T11 중상",11,True)]:
        r2,_=play(it,sev)
        print("  반사실 — %s 발생 시: OVR %.1f (%s), 손실턴 %d, 평가전 %s"%(label,ovr(r2.cur,"OH"),grade(ovr(r2.cur,"OH")),r2.turns_lost,[m[0] for m in r2.match_results]))
    # 같은 카드, 안전 정책 수순(기대값)
    rng=random.Random(0); run=Run(CARD,rng,deterministic=True); seq=[]
    for t in range(1,13):
        run.turn=t; a=policy_safe(run); run.do_action(a); seq.append(ACTION_KO[a])
        if t in STORY_TURNS: run.story_event(STORY_TURNS[t])
        if t in EVAL_TURNS: run.eval_match(EVAL_TURNS[t],forced=forced[t])
    print("  참고 — 안전 정책(피로35↑ 휴식) 같은 조건 기대값: OVR %.1f (%s), 수순 %s"%(ovr(run.cur,"OH"),grade(ovr(run.cur,"OH")),"→".join(seq)))

# ---------- 메인 ----------
if __name__=="__main__":
    t0=time.time()
    quick="--quick" in sys.argv
    N_MAIN=1500 if quick else 3000
    N_SWEEP=400 if quick else 1000
    N_LEVER=300 if quick else 800
    N_SUP=600 if quick else 2000
    N_CARD=400 if quick else 1000
    base_ovr=ovr(CARD["stats"],"OH")
    worked_example()

    pool=Pool(os.cpu_count() or 2)
    # 2) 정책별 (v0.2 규칙, 서포터 없음)
    names=[("안전(피로 35↑ 휴식)","safe"),("최적(배지 >%.0f%% 휴식)"%(OPT_INJ_THRESH*100),"optimal"),("푸시(배지 >%.0f%% 휴식)"%(PUSH_INJ_THRESH*100),"push"),
           ("무휴식 몰빵","norest"),("랜덤","random"),("스파이크만","spike")]
    res=run_jobs([(DEFAULT_CFG,pn,N_MAIN,1,CARD,[],0.0) for _,pn in names],pool)
    print("\n=== 2) 정책별 몬테카를로 (v0.2 규칙, n=%d, SSR OH, 서포터 없음) ==="%N_MAIN)
    print(POLICY_HEADER)
    for (label,_),r in zip(names,res): print(fmt_policy(label,r,base_ovr))
    safe=res[0]; opt=res[1]; push=res[2]; nr=res[3]; rd=res[4]
    print("  → 최적−안전 %+.1f / 푸시−안전 %+.1f / 최적−랜덤 %+.1f / 무휴식−최적 %+.1f | 최적 부상시 OVR %.1f vs 안전 %.1f (%+.1f, 도박 성립: %s)"%(
        opt["ovr"]-safe["ovr"],push["ovr"]-safe["ovr"],opt["ovr"]-rd["ovr"],nr["ovr"]-opt["ovr"],opt["ovr_inj"],safe["ovr"],opt["ovr_inj"]-safe["ovr"],"O" if opt["ovr_inj"]<=safe["ovr"]+0.1 else "X"))
    v01=run_jobs([(V01_CFG,pn,N_MAIN,1,CARD,[],0.0) for pn in ["safe","optimal","norest","random"]],pool)
    print("  (참고) v0.1 규칙을 같은 정책으로 재현: 안전 %.1f(σ%.1f) / 최적 %.1f(σ%.1f, 부상 %.0f%%) / 무휴식 %.1f / 랜덤 %.1f"%(
        v01[0]["ovr"],v01[0]["sd"],v01[1]["ovr"],v01[1]["sd"],v01[1]["inj"]*100,v01[2]["ovr"],v01[3]["ovr"]))

    # 3) 임계값 스윕
    ths=[0.0,0.04,0.06,0.08,0.10,0.12,0.15,0.20,0.25,0.30,0.40,1.0]
    safes=[("safe",35),("safe",45),("safe",50),("safe",60)]
    res=run_jobs([(DEFAULT_CFG,th,N_SWEEP,2,CARD,[],0.0) for th in ths]+[(DEFAULT_CFG,s,N_SWEEP,2,CARD,[],0.0) for s in safes],pool)
    print("\n=== 3) 휴식 임계값 스윕 — v0.2 규칙, n=%d (위: 부상 배지 임계 정책, 아래: 피로 임계 안전 정책) ==="%N_SWEEP)
    print("| 정책 | OVR | σ | p10 / p90 | S% | A% | B% | 부상률 | 무부상 OVR | 부상시 OVR | 휴식 | 핫존 훈련 | 훈련 수 |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for th,r in zip(ths,res[:len(ths)]):
        print("| 배지 >%s 휴식 | %.1f | %.2f | %.1f / %.1f | %.0f | %.0f | %.0f | %.0f%% | %.1f | %.1f | %.1f | %.1f | %.1f |"%(
            ("100%(무휴식)" if th>=1 else "%.0f%%"%(th*100)),r["ovr"],r["sd"],r["p10"],r["p90"],r["grades"]["S"]*100,r["grades"]["A"]*100,r["grades"]["B"]*100,r["inj"]*100,r["ovr_noinj"],r["ovr_inj"],r["rests"],r["hot"],r["trains"]))
    for (_,ra),r in zip(safes,res[len(ths):]):
        print("| 피로 ≥%d 휴식(안전형) | %.1f | %.2f | %.1f / %.1f | %.0f | %.0f | %.0f | %.0f%% | %.1f | %.1f | %.1f | %.1f | %.1f |"%(
            ra,r["ovr"],r["sd"],r["p10"],r["p90"],r["grades"]["S"]*100,r["grades"]["A"]*100,r["grades"]["B"]*100,r["inj"]*100,r["ovr_noinj"],r["ovr_inj"],r["rests"],r["hot"],r["trains"]))

    # 4) 레버 조합 비교
    A=dict(V01_CFG,hot_lo=45,hot_mult=1.50); MID=(0.15,0.70,0.15)
    levers=[
        ("v0.1 규칙(기준)", V01_CFG),
        ("(a) 핫존 50~79 ×1.10→×1.30", dict(V01_CFG,hot_mult=1.30)),
        ("(a') 핫존 45~79 ×1.50", A),
        ("(b) 콤보 +5/10/15%", dict(V01_CFG,combo_step=0.05,combo_cap=0.15)),
        ("(c) 특훈 등장 → 핫존", dict(V01_CFG,special_zone="hot")),
        ("(d1) 휴식 컨디션+1 70→50%, 멘탈 0 [기각]", dict(V01_CFG,rest_cond_up=0.50,rest_mental=0.0)),
        ("(d2) 얕은 휴식(피로<50) 컨디션+1 30%", dict(V01_CFG,rest_deep_at=50,rest_cond_up_shallow=0.30)),
        ("(d3) 콜드존 <30 ×0.85", dict(V01_CFG,cold_hi=30,cold_mult=0.85)),
        ("(e) 컨디션 폭 1.30/0.60 + 분기 50%", dict(V01_CFG,cond_mult=DEFAULT_CFG["cond_mult"],event_branch=0.50)),
        ("(f) 핫존 드리프트 35→15% + 부상 시작 40→45", dict(V01_CFG,drift_hot=MID,inj_start=45)),
        ("(g) 부상 손실↑(경상 신체−3, 중상 전스탯−3, 재부상×2)", dict(V01_CFG,light_loss=3,severe_all_loss=3,severe_loss=0,reinjury_mult=2.0)),
        ("누적 a'+b+c", dict(A,combo_step=0.05,combo_cap=0.15,special_zone="hot")),
        ("누적 +f", dict(A,combo_step=0.05,combo_cap=0.15,special_zone="hot",drift_hot=MID,inj_start=45)),
        ("누적 +d2+d3", dict(A,combo_step=0.05,combo_cap=0.15,special_zone="hot",drift_hot=MID,inj_start=45,rest_deep_at=50,rest_cond_up_shallow=0.30,cold_hi=30,cold_mult=0.85)),
        ("누적 +e+g (BASE 5.0)", dict(DEFAULT_CFG,base=5.0)),
        ("누적 +h BASE 5.0→4.6 = **v0.2 채택**", DEFAULT_CFG),
        ("v0.2 + (d1) [기각 재확인]", dict(DEFAULT_CFG,rest_cond_up=0.50,rest_mental=0.0)),
        ("v0.2 + 핫존 ×1.60 [보류]", dict(DEFAULT_CFG,hot_mult=1.60)),
        ("v0.2 + 턴 편차 ±25→±35% [분산 참고]", dict(DEFAULT_CFG,rand_eps=0.35)),
        ("v0.2 + 체감수확 20→30 [기각]", dict(DEFAULT_CFG,diminish_full=30)),
    ]
    pols=["safe","optimal","push","norest"]
    specs=[(cfg,pn,N_LEVER,3,CARD,[],0.0) for _,cfg in levers for pn in pols]
    res=run_jobs(specs,pool)
    print("\n=== 4) 레버 조합 비교 (n=%d, SSR OH, 서포터 없음; 정책 정의는 v0.2 기준으로 고정) ==="%N_LEVER)
    print("| 레버 | 안전 OVR (A↑%) | 최적 OVR (σ) | 최적−안전 | 최적 부상률 | 최적 부상시−안전 | 최적 S% | 푸시 OVR (σ) / 부상률 | 무휴식 OVR / 부상률 |")
    print("|---|---|---|---|---|---|---|---|---|")
    for i,(label,_) in enumerate(levers):
        s,o,p,nr=res[i*4:(i+1)*4]
        print("| %s | %.1f (%.0f) | %.1f (%.1f) | **%+.1f** | %.0f%% | %+.1f | %.0f%% | %.1f (%.1f) / %.0f%% | %.1f / %.0f%% |"%(
            label,s["ovr"],(s["grades"]["A"]+s["grades"]["S"])*100,o["ovr"],o["sd"],o["ovr"]-s["ovr"],o["inj"]*100,o["ovr_inj"]-s["ovr"],o["grades"]["S"]*100,
            p["ovr"],p["sd"],p["inj"]*100,nr["ovr"],nr["inj"]*100))

    # 5) 서포터 강도별
    print("\n=== 5) 서포터 강도별 (v0.2 규칙, n=%d, SSR OH) ==="%N_SUP)
    for label,sups in SUPPORT_LEVELS:
        if sups: print("  [%s] %s"%(label,Support(CARD,sups).summary()))
    specs=[(DEFAULT_CFG,pn,N_SUP,4,CARD,sups,0.0) for _,sups in SUPPORT_LEVELS for pn in ["safe","optimal","push"]]
    res=run_jobs(specs,pool)
    print("| 서포터 | 안전 OVR / S% / A↑% | 최적 OVR (σ) / S% / 부상률 | 푸시 OVR (σ) / S% / 부상률 | 핵심 도달(최적) | 선배 이벤트/런 |")
    print("|---|---|---|---|---|---|")
    for i,(label,_) in enumerate(SUPPORT_LEVELS):
        s,o,p=res[i*3:(i+1)*3]
        print("| %s | %.1f / %.0f%% / %.0f%% | %.1f (%.1f) / **%.0f%%** / %.0f%% | %.1f (%.1f) / %.0f%% / %.0f%% | %.0f%% | %.1f |"%(
            label,s["ovr"],s["grades"]["S"]*100,(s["grades"]["S"]+s["grades"]["A"])*100,o["ovr"],o["sd"],o["grades"]["S"]*100,o["inj"]*100,
            p["ovr"],p["sd"],p["grades"]["S"]*100,p["inj"]*100,o["core"]*100,o["sup_events"]))
    r=run_jobs([(DEFAULT_CFG,"optimal",N_SUP,4,CARD,[],0.25)],pool)[0]
    print("  (참고) 균일 +25%% 보정(v0.1 가정), 최적: OVR %.1f S %.0f%%"%(r["ovr"],r["grades"]["S"]*100))
    rec=recommend_supporters(CARD,[SUP_SR_OH_B,SUP_SSR_OH_A,SUP_SSR_MB_A,SUP_SSR_OH_S,SUP_SSR_MB_S,SUP_SSR_L_S])
    print("  자동 추천(SSR OH, 로스터 6명 중 3명):",[s["name"] for s in rec])

    # 6) 희귀도·포지션
    print("\n=== 6) 희귀도·포지션별 (v0.2 규칙, n=%d, 서포터 없음) ==="%N_CARD)
    cards=[("SSR OH",CARD),("SR OH",SR_OH),("R OH",R_OH),("SSR S",SSR_S),("SSR OP",SSR_OP),("SSR MB",SSR_MB),("SSR L",SSR_L)]
    specs=[(DEFAULT_CFG,pn,N_CARD,5,c,[],0.0) for _,c in cards for pn in ["safe","optimal","random"]]
    res=run_jobs(specs,pool)
    print("| 카드 | 안전 OVR / 등급 | 최적 OVR (σ) / 등급 / 부상률 | 랜덤 OVR / 등급 | 최적−안전 | 최적−랜덤 |")
    print("|---|---|---|---|---|---|")
    for i,(label,c) in enumerate(cards):
        s,o,rd=res[i*3:(i+1)*3]
        gs=lambda r: " ".join("%s%.0f"%(k,r["grades"][k]*100) for k in "SABCD" if r["grades"][k]>=0.005)
        print("| %s | %.1f / %s | %.1f (%.1f) / %s / %.0f%% | %.1f / %s | %+.1f | %+.1f |"%(label,s["ovr"],gs(s),o["ovr"],o["sd"],gs(o),o["inj"]*100,rd["ovr"],gs(rd),o["ovr"]-s["ovr"],o["ovr"]-rd["ovr"]))
    pool.close(); pool.join()

    print("\n=== 부상 확률표 (v0.2: 시작 45, 서포터 없음) ===")
    print("| 피로 | 기본(1.0) | 토스(0.7) | 스파이크(1.3) | 특훈(1.5) | 부상 이력(스파이크 ×%.1f) | 풀세팅 서포터(스파이크 ×%.2f) |"%(CFG["reinjury_mult"],SUP_INJ_FLOOR))
    print("|---|---|---|---|---|---|---|")
    for f in [45,50,55,60,65,70,75,80,90,100]:
        print("| %d | %.1f%% | %.1f%% | %.1f%% | %.1f%% | %.1f%% | %.1f%% |"%(
            f,injury_p(f,1.0)*100,injury_p(f,0.7)*100,injury_p(f,1.3)*100,injury_p(f,1.5)*100,injury_p(f,1.3,CFG["reinjury_mult"])*100,injury_p(f,1.3,SUP_INJ_FLOOR)*100))
    print("\n=== 강도 곡선 × 기본 훈련 원점수 (BASE %.1f, 적성 B, 컨디션 보통, 잔여 ≥20) ==="%CFG["base"])
    for f in [0,30,45,60,79,80]:
        print("피로 %3d %s ×%.2f → 주 %.2f / 부1 %.2f / 부2 %.2f (합 %.2f)"%(f,zone_name(f),zone_mult(f),CFG["base"]*zone_mult(f),CFG["base"]*0.5*zone_mult(f),CFG["base"]*0.25*zone_mult(f),CFG["base"]*1.75*zone_mult(f)))
    print("\n소요 %.1fs"%(time.time()-t0))
