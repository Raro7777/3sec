"""
league-and-economy.md 수치 검증용 경제·리그 몬테카를로 (표준 라이브러리만, 기본 n=500 · 6 시나리오 ≈ 25초).

문서(docs/league-and-economy.md)의 초기값을 그대로 구현하고 시즌 1~3(옵션 --seasons 5)의
  1) 티켓 수입·지출 흐름(소스별), 스카우트 횟수, 희귀도별 획득 분포, 첫 SSR 시점
  2) 포지션 충원 시점(연습생·N 카드가 라인업에서 사라지는 매치데이), 한계돌파 빈도
  3) 리그 순위 분포·승률·첫 4강/첫 우승 시즌 (승률 = 라인업 OVR 차의 로지스틱 근사)
  4) 현행 프로토타입 규칙(초기 5장·승리 +1·조각·천장 없음·포지션 지정 없음)과의 비교
를 출력한다. 경기 결과는 실제 시뮬(MatchSimulator)이 아니라 밸런스 리포트 9절(overall 차 → 승률)에
맞춘 로지스틱 근사이므로, 순위·승률 수치는 "가설"이며 구현 단계에서 실제 시뮬로 재검증한다.

실행: python3 tools/economy-sim/economy_sim.py            (--quick 로 n 축소, --seasons 5, --seed 1, --only new)
데이터: data/players.json 을 읽어 42명 카드 풀·6구단 전력(성장률 g)을 계산한다.
모든 잡은 시드 고정이라 같은 값이 재현된다.

--- v0.2 (문서 league-and-economy v0.2 와 동시 갱신) -------------------------------------------
이 스크립트는 더 이상 "문서 초기값"의 구현이 아니라 **실제 게임 엔진(web/engine/*.js)의 근사 모델**이다.
v0.1 의 초기값은 ① 승률 로지스틱 근사 위에서 ② 결원 보충(A.3.5) 미반영으로 잡힌 값이었고,
실제 MatchSimulator 위에서는 시즌 1 이 너무 쉬웠다(승률 59% / 우승 38%). 그래서 web 엔진이
사다리 g·결원 강도·중복 처리를 재캘리브레이션했고, 여기 DEFAULT_CFG 를 그 값에 맞췄다.

**권위 있는 수치는 이 스크립트가 아니라 `node web/season-check.mjs`(실제 엔진) 이다.**
이 스크립트는 (a) 천장 규칙처럼 대량 표본이 필요한 계산과 (b) 엔진에 없는 대조군(현행 프로토타입
규칙·정식 미션 시나리오)을 싸게 돌려 보는 용도로 남긴다. 근사 모델이라 승률·순위는 엔진과 어긋난다
(차이는 문서 B.3.1 아래 대조표 참조).

엔진에서 실측해 옮겨 온 상수: ladder / vacancy_ovr_delta / filler_ovr·per_season·cap / shards_per_dup
"""
import argparse, json, math, os, random, sys, time
from collections import Counter, defaultdict

STATS = ["serve", "receive", "set", "spike", "block", "dig", "speed", "power", "stamina", "mental"]
POSITIONS = ["S", "OH", "OP", "MB", "L"]
LINEUP_SLOTS = ["S", "OH", "OH", "OP", "MB", "MB", "L"]
SLOT_NEED = {"S": 1, "OH": 2, "OP": 1, "MB": 2, "L": 1}
RARITIES = ["R", "SR", "SSR"]
# training-mode.md 8.2 포지션 가중 OVR
OVR_W = {
    "S":  [.10, .08, .30, .06, .08, .08, .10, .04, .04, .12],
    "OH": [.10, .18, .04, .22, .08, .08, .08, .10, .06, .06],
    "OP": [.12, .05, .03, .28, .10, .04, .08, .14, .08, .08],
    "MB": [.08, .04, .03, .18, .26, .03, .10, .14, .08, .06],
    "L":  [0.0, .28, .06, 0.0, 0.0, .26, .16, .04, .10, .10],
}
POS_SCALE = {"S": 1.0, "OH": 1.0, "OP": 1.0, "MB": 1.0, "L": 0.95}
CORE3 = {"S": ["set", "mental", "speed"], "OH": ["spike", "receive", "serve"], "OP": ["spike", "power", "serve"],
         "MB": ["block", "spike", "power"], "L": ["receive", "dig", "speed"]}
CLUB_NAMES = {"t01": "가온", "t02": "해솔", "t03": "태령", "t04": "적동", "t05": "연화", "t06": "라온"}
# match-sim.md 3.1 포지션 프로파일(overall 67) — N 무명 신인 생성용
PROFILE = {"S": [62, 58, 82, 50, 58, 66, 70, 52, 68, 72], "OH": [68, 72, 52, 74, 62, 66, 70, 68, 70, 64],
           "OP": [70, 52, 48, 78, 64, 55, 64, 76, 66, 64], "MB": [58, 45, 45, 70, 78, 50, 62, 70, 64, 62],
           "L": [40, 82, 60, 30, 30, 82, 78, 45, 72, 66]}

# ---------------- 초기값 (문서와 1:1, 튜닝 전제) ----------------
DEFAULT_CFG = dict(
    # 리그 (A.1, A.3, A.4)
    seasons=3, rounds=14,
    points_rule={"3-0": (3, 0), "3-1": (3, 0), "3-2": (2, 1)},
    playoff_teams=4, semi_bestof=1, po_bestof=3, final_bestof=5, final_advantage=1,
    # 사다리 g — web/engine/game.js SEASON_GROWTH 와 1:1 (v0.1 초기값 [.35 .48 .58 .66 .72 .76] 에서 재캘리브레이션)
    ladder=[0.52, 0.63, 0.74, 0.80, 0.80, 0.80, 0.80], ladder_cap=0.80,
    club_g_offset={"t01": 0.0, "t02": 0.0, "t03": 0.0, "t04": 0.0, "t05": 0.0, "t06": 0.0},
    k_logit=0.235,          # 승률 = sigmoid(k × (내 라인업 OVR − 상대 OVR) + 홈)  (밸런스 리포트 9절 회귀)
    home_logit=0.10,        # 홈 이점(로짓). 경기 시뮬 HomeCourtLogit 의 승률 환산 가정치
    # A.3.5 결원 보충: 스카우트된 선수 자리에 들어가는 대체 선수의 OVR = 그 구단 원 로스터 평균 OVR + delta.
    # 엔진은 stat 평균 공간에서 −4(VACANCY.overallDelta)를 주고, 그것이 포지션 가중 OVR 공간에서
    # −7.4 로 나온다(g 35~80% 구간에서 −7.32 ~ −7.53, 42쌍 실측). 여기서는 OVR 공간의 −7.4 를 쓴다.
    vacancy=True, vacancy_ovr_delta=-7.4,
    # 연습생 라인업 OVR — 엔진 실측(fillerOverall 44 +1/시즌·상한 48 → OVR 46.00 / +0.83 / 고원 49.7)
    filler_ovr=46.0, filler_per_season=0.83, filler_cap=49.7,
    # 스카우트 (B.2)
    rate={"R": 0.80, "SR": 0.17, "SSR": 0.03},
    pity_sr=10, pity_ssr=60,
    price_general_ticket=1, price_pos_ticket=1, price_pos_gold=1200,
    # 중복 처리 — 엔진은 조각 풀이 하나뿐이고 중복이 곧바로 한계돌파 1단계를 준다(조각 지급 0).
    # 문서 v0.1 의 "중복 → 희귀도 조각 10 → 30개마다 1단계"는 미구현이다. 조각 10을 같이 주면
    # 뽑기 1회가 뽑기 0.83회를 재생산해 시즌 2 스카우트가 폭주한다(PARITY.md 시즌 계층 절).
    shards_per_dup=0, dup_limit_break=True, lb_cost=30, lb_max=5, lb_potential=3, shard_up_ratio=5,
    n_card_stats=42.0, n_card_potential=57.0,   # 포지션 지정 폴백용 N 무명 신인(평균 stats / potential)
    # 수입 (B.3) — 티켓은 승리·순위·마일스톤에서만, 경기 참가는 조각으로
    # 튜토리얼 SR 세터 확정 지급은 문서 v0.1 의 계획이고 web 엔진에는 없다(createGame 의 ownedCards 는 빈 객체).
    # 엔진과 맞추려고 기본을 False 로 내린다. --tutorial-setter 로 되살려 효과만 볼 수 있다.
    init_tickets=5, init_gold=1200, tutorial_sr_setter=False,
    match_shards=2, win_shards=4, shards_per_ticket=12,
    match_gold=100, win_gold=180, set_gold=25, home_gold=50,
    rank_tickets=[8, 7, 6, 5, 4, 4, 3], rank_gold=[2600, 2200, 1800, 1500, 1200, 900, 700],
    playoff_entry_ticket=1, playoff_win_ticket=1, champion_ticket=3, champion_gold=2000,
    first_grad_ticket=1, grad_milestones={5: 2, 10: 2, 20: 3, 40: 4, 70: 5, 100: 6},
    grad_gold={"S": 700, "A": 500, "B": 350, "C": 220, "D": 130},
    daily_ticket=0, weekly_ticket=0, days_per_matchday=1,   # 정식: 일일 1 / 주간 3
    # 육성 (training-mode 12.1 최적 정책 기준)
    trainings_per_matchday=1, preseason_trainings=2, retrain_max=3,
    reach_core=0.61, reach_other=0.36, ovr_sigma=1.7, policy_offset=0.0,   # 안전 정책이면 −2.2
    supporter_bonus=[0.0, 0.4, 0.6, 0.8], supporter_s_bonus=0.3,
    # 정책
    scout_mode="smart",     # smart | general_only
    proto_rules=False,      # True = 현행 프로토타입 규칙
)


def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-x))


def ovr_of(stats, pos):
    return POS_SCALE[pos] * sum(w * v for w, v in zip(OVR_W[pos], stats))


def grade_of(ovr):
    return "S" if ovr >= 80 else "A" if ovr >= 74 else "B" if ovr >= 66 else "C" if ovr >= 55 else "D"


def mean(xs):
    xs = list(xs)
    return sum(xs) / len(xs) if xs else float("nan")


def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return float("nan")
    k = (len(xs) - 1) * p
    f = math.floor(k); c = math.ceil(k)
    return xs[f] if f == c else xs[f] + (xs[c] - xs[f]) * (k - f)


def load_players():
    here = os.path.dirname(os.path.abspath(__file__))
    for cand in (os.path.join(here, "..", "..", "data", "players.json"), os.path.join(os.getcwd(), "data", "players.json")):
        if os.path.exists(cand):
            with open(cand, encoding="utf-8") as f:
                return json.load(f)
    sys.exit("data/players.json 을 찾을 수 없습니다")


class Card:
    __slots__ = ("id", "name", "pos", "rarity", "team", "stats", "pot")

    def __init__(self, id, name, pos, rarity, team, stats, pot):
        self.id, self.name, self.pos, self.rarity, self.team, self.stats, self.pot = id, name, pos, rarity, team, stats, pot

    def expected_grad_ovr(self, cfg, lb=0):
        """최적 정책 기대 졸업 OVR: 핵심3 도달 61% · 나머지 36%.

        training-mode 12.1 표(SSR OH 78.4 / SR OH 68.1 / R OH 57.4 / SSR S 76.9 / OP 77.9 / MB 78.8 / L 79.1)에
        최소제곱으로 맞춘 값. 잔차: R OH +2.5, SSR L +4.7(백윤슬은 문서의 제네릭 SSR L 보다 강한 카드라 과대가 아님).
        """
        core = CORE3[self.pos]
        fin = []
        for k, s, p in zip(STATS, self.stats, self.pot):
            p = min(100.0, p + lb * cfg["lb_potential"])
            r = cfg["reach_core"] if k in core else cfg["reach_other"]
            fin.append(min(p, s + r * (p - s)))
        return ovr_of(fin, self.pos) + cfg["policy_offset"]


def build_pool(players, cfg):
    pool = [Card(p["id"], p["name"], p["position"], p["rarity"], p["teamId"],
                 [p["stats"][k] for k in STATS], [p["potential"][k] for k in STATS]) for p in players]
    for pos in POSITIONS:
        prof = PROFILE[pos]
        m = sum(prof) / 10
        pool.append(Card("N-" + pos, "무명 신인(" + pos + ")", pos, "N", "u00",
                         [v * cfg["n_card_stats"] / m for v in prof], [v * cfg["n_card_potential"] / m for v in prof]))
    return pool


def club_strength(players, g_by_club, departed=None, vacancy_delta=0.0):
    """구단별 평균 OVR. departed 에 든 카드 id 는 플레이어가 스카우트해 간 결원이라
    같은 포지션의 대체 선수(그 구단 **원** 로스터 평균 + vacancy_delta)로 갈아 끼운다(A.3.5).
    대체 선수 강도의 기준이 되는 평균은 결원이 늘어도 흔들리지 않게 원본 기준으로 고정한다
    (web/engine/game.js clubTeamState 와 같은 규칙)."""
    by_team = defaultdict(list)
    ids_by_team = defaultdict(list)
    for p in players:
        g = g_by_club[p["teamId"]]
        # A.3.1 실효스탯 = clamp(round(stats + g×(potential − stats)), 0, 100).
        # 엔진은 roundHalfEven 을 쓰고 파이썬 내장 round() 도 half-to-even 이라 결과가 같다.
        st = [min(100.0, max(0.0, round(p["stats"][k] + g * (p["potential"][k] - p["stats"][k])))) for k in STATS]
        by_team[p["teamId"]].append(ovr_of(st, p["position"]))
        ids_by_team[p["teamId"]].append(p["id"])
    out = {}
    for t, v in by_team.items():
        base = sum(v) / len(v)
        if not departed:
            out[t] = base
            continue
        sub = base + vacancy_delta
        out[t] = sum(sub if cid in departed else o for cid, o in zip(ids_by_team[t], v)) / len(v)
    return out


def club_ovr_table(players, g_by_club):
    """{teamId: ([(cardId, ovr), ...], 원 로스터 평균 OVR)} — 결원 반영을 매치데이마다 싸게 다시 계산하기 위한 캐시."""
    by_team = defaultdict(list)
    for p in players:
        g = g_by_club[p["teamId"]]
        # A.3.1 실효스탯 = clamp(round(stats + g×(potential − stats)), 0, 100).
        # 엔진은 roundHalfEven 을 쓰고 파이썬 내장 round() 도 half-to-even 이라 결과가 같다.
        st = [min(100.0, max(0.0, round(p["stats"][k] + g * (p["potential"][k] - p["stats"][k])))) for k in STATS]
        by_team[p["teamId"]].append((p["id"], ovr_of(st, p["position"])))
    return {t: (v, sum(o for _, o in v) / len(v)) for t, v in by_team.items()}


def club_strength_now(table, departed, vacancy_delta):
    """club_ovr_table 결과 + 현재 결원 집합 → {teamId: 평균 OVR}."""
    if not departed:
        return {t: base for t, (v, base) in table.items()}
    out = {}
    for t, (v, base) in table.items():
        sub = base + vacancy_delta
        out[t] = sum(sub if cid in departed else o for cid, o in v) / len(v)
    return out


def p_match_from_set(p):
    q = 1 - p
    return p ** 3 * (1 + 3 * q + 6 * q * q)


_PSET_CACHE = {}


def p_set_from_match(pm):
    key = round(pm, 4)
    hit = _PSET_CACHE.get(key)
    if hit is not None:
        return hit
    lo, hi = 0.0, 1.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if p_match_from_set(mid) < pm:
            lo = mid
        else:
            hi = mid
    _PSET_CACHE[key] = v = (lo + hi) / 2
    return v


def play_match(rng, ovr_home, ovr_away, cfg):
    pm = sigmoid(cfg["k_logit"] * (ovr_home - ovr_away) + cfg["home_logit"])
    ps = p_set_from_match(pm)
    h = a = 0
    while h < 3 and a < 3:
        if rng.random() < ps:
            h += 1
        else:
            a += 1
    return h, a


def round_robin_schedule(teams, rng):
    """7팀 더블 라운드로빈 14라운드(라운드마다 1팀 휴식). 라운드별 (홈, 원정) 목록."""
    ids = list(teams) + ([None] if len(teams) % 2 else [])
    m = len(ids)
    rounds = []
    arr = ids[:]
    for r in range(m - 1):
        pairs = []
        for i in range(m // 2):
            a, b = arr[i], arr[m - 1 - i]
            if a is None or b is None:
                continue
            pairs.append((a, b) if (r + i) % 2 == 0 else (b, a))
        rounds.append(pairs)
        arr = [arr[0]] + [arr[-1]] + arr[1:-1]
    second = [[(b, a) for (a, b) in rd] for rd in rounds]
    rng.shuffle(rounds)
    rng.shuffle(second)
    return rounds + second


class Run:
    def __init__(self, seed, pool, players, cfg):
        self.rng = random.Random(seed)
        self.cfg = cfg
        self.players = players
        self.cards = {c.id: c for c in pool}
        self.by_rarity_pos = defaultdict(list)
        self.by_rarity = defaultdict(list)
        for c in pool:
            if c.rarity != "N":
                self.by_rarity_pos[(c.rarity, c.pos)].append(c)
                self.by_rarity[c.rarity].append(c)
        self.n_cards = {c.pos: c for c in pool if c.rarity == "N"}
        # 지갑·상태
        self.tickets = cfg["init_tickets"]
        self.gold = cfg["init_gold"]
        self.shards = {"R": 0, "SR": 0, "SSR": 0}
        self.frag = 0                      # 프로토타입 규칙용 스카우트 조각
        self.owned = {}                    # cardId → 한계돌파 횟수
        self.inst = {}                     # cardId → [대표 OVR, 인스턴스 수]
        self.pending_retrain = set()       # 한계돌파 후 미갱신 카드
        self.pity_sr = 0
        self.pity_ssr = 0
        self.pulls = 0
        self.pull_log = []                 # (season, matchday, rarity, dup)
        self.grads = 0
        self.first_grad_given = False
        self.milestones_given = set()
        self.first_ssr = None              # (season, matchday, pull index)
        self.first_win = None              # (season, matchday, trainings_so_far)
        self.first_final4 = None
        self.first_title = None
        self.income = Counter()
        self.spent = Counter()
        self.lb_count = 0
        self.lb_prev = 0
        self.po_wins = 0
        self.stats_by_season = []
        self.season_idx = 1
        self._lineup_cache = None

    # ---------- 라인업 ----------
    def filler_ovr(self):
        cfg = self.cfg
        return min(cfg["filler_cap"], cfg["filler_ovr"] + cfg["filler_per_season"] * (self.season_idx - 1))

    def lineup(self):
        """슬롯 순서(S OH OH OP MB MB L)대로 (cardId|None, OVR). 로스터가 바뀔 때만 재계산."""
        if self._lineup_cache is not None:
            return self._lineup_cache
        out = []
        for pos in POSITIONS:
            cands = sorted(((rec[0], cid) for cid, rec in self.inst.items() if self.cards[cid].pos == pos), reverse=True)
            for i in range(SLOT_NEED[pos]):
                out.append((cands[i][1], cands[i][0]) if i < len(cands) else (None, self.filler_ovr()))
        self._lineup_cache = out
        return out

    def lineup_ovr(self):
        return sum(o for _, o in self.lineup()) / 7

    def holes(self):
        """연습생 또는 N 카드가 차지한 슬롯 수."""
        return sum(1 for cid, _ in self.lineup() if cid is None or cid.startswith("N-"))

    def uncovered_position(self):
        """보유(미육성 포함) 정식 카드로 못 채우는 슬롯의 포지션 (첫 번째)."""
        cover = Counter(self.cards[cid].pos for cid in self.owned if not cid.startswith("N-"))
        for pos in POSITIONS:
            if cover[pos] < SLOT_NEED[pos]:
                return pos
        return None

    def supporter_bonus(self):
        cfg = self.cfg
        n_b = sum(1 for rec in self.inst.values() if rec[0] >= 66)
        n_s = sum(1 for rec in self.inst.values() if rec[0] >= 80)
        return cfg["supporter_bonus"][min(3, n_b)] + (cfg["supporter_s_bonus"] if n_s >= 3 else 0.0)

    # ---------- 스카우트 ----------
    def roll_rarity(self):
        cfg = self.cfg
        rate = cfg["rate"]
        if cfg["proto_rules"]:
            r = self.rng.random()
            return "R" if r < rate["R"] else ("SR" if r < rate["R"] + rate["SR"] else "SSR")
        self.pity_sr += 1
        self.pity_ssr += 1
        if self.pity_ssr >= cfg["pity_ssr"]:
            rar = "SSR"
        elif self.pity_sr >= cfg["pity_sr"]:
            rar = "SSR" if self.rng.random() < rate["SSR"] / (rate["SSR"] + rate["SR"]) else "SR"
        else:
            r = self.rng.random()
            rar = "R" if r < rate["R"] else ("SR" if r < rate["R"] + rate["SR"] else "SSR")
        if rar in ("SR", "SSR"):
            self.pity_sr = 0
        if rar == "SSR":
            self.pity_ssr = 0
        return rar

    def receive_card(self, card, season, md, count_pull=True):
        cfg = self.cfg
        if count_pull:
            self.pulls += 1
        dup = card.id in self.owned and card.rarity != "N"
        if card.rarity == "N":
            self.owned.setdefault(card.id, 0)
        elif dup:
            if cfg["proto_rules"] or cfg["dup_limit_break"]:
                # 중복 = 한계돌파 1단계 즉시(web 엔진 규칙). 조각은 주지 않는다.
                if self.owned[card.id] < cfg["lb_max"]:
                    self.owned[card.id] += 1
                    self.lb_count += 1
                    if card.id in self.inst:
                        self.pending_retrain.add(card.id)
            else:
                self.shards[card.rarity] += cfg["shards_per_dup"]
        else:
            self.owned[card.id] = 0
        if count_pull:
            self.pull_log.append((season, md, card.rarity, dup))
            if card.rarity == "SSR" and self.first_ssr is None:
                self.first_ssr = (season, md, self.pulls)

    def scout_general(self, season, md):
        cfg = self.cfg
        self.tickets -= cfg["price_general_ticket"]
        self.spent["일반 티켓"] += cfg["price_general_ticket"]
        self.receive_card(self.rng.choice(self.by_rarity[self.roll_rarity()]), season, md)

    def scout_position(self, pos, season, md):
        cfg = self.cfg
        self.tickets -= cfg["price_pos_ticket"]
        self.gold -= cfg["price_pos_gold"]
        self.spent["포지션 지정 티켓"] += cfg["price_pos_ticket"]
        self.spent["포지션 지정 골드"] += cfg["price_pos_gold"]
        cands = self.by_rarity_pos.get((self.roll_rarity(), pos), [])
        self.receive_card(self.rng.choice(cands) if cands else self.n_cards[pos], season, md)

    def scout_phase(self, season, md):
        cfg = self.cfg
        while self.tickets >= 1:
            if cfg["proto_rules"] or cfg["scout_mode"] == "general_only":
                self.scout_general(season, md)
                continue
            # 스마트 정책: 미보유 포지션 → 지정, 시즌 2+ 에서 대표가 R 인 슬롯 → 지정, 아니면 일반
            target = self.uncovered_position()
            if target is None and season >= 2:
                for cid, _ in self.lineup():
                    if cid is not None and self.cards[cid].rarity == "R":
                        target = self.cards[cid].pos
                        break
            if target is not None and self.gold >= cfg["price_pos_gold"] and self.tickets >= cfg["price_pos_ticket"]:
                self.scout_position(target, season, md)
            else:
                self.scout_general(season, md)

    # ---------- 한계돌파 ----------
    def limit_break_phase(self):
        cfg = self.cfg
        if cfg["proto_rules"]:
            return
        in_lineup = {cid for cid, _ in self.lineup() if cid}
        for rar in RARITIES:
            while self.shards[rar] >= cfg["lb_cost"]:
                cands = [(cid in in_lineup, rec[0], cid) for cid, rec in self.inst.items()
                         if self.cards[cid].rarity == rar and self.owned[cid] < cfg["lb_max"]]
                if not cands:
                    break
                cands.sort(reverse=True)
                cid = cands[0][2]
                self.shards[rar] -= cfg["lb_cost"]
                self.owned[cid] += 1
                self.lb_count += 1
                self.pending_retrain.add(cid)
            # 대상이 없어 남은 조각은 상향 변환(5:1)
            nxt = {"R": "SR", "SR": "SSR", "SSR": None}[rar]
            if nxt and self.shards[rar] >= cfg["lb_cost"]:
                conv = (self.shards[rar] // cfg["lb_cost"]) * cfg["lb_cost"]
                self.shards[rar] -= conv
                self.shards[nxt] += conv // cfg["shard_up_ratio"]

    # ---------- 육성 ----------
    def train_one(self):
        cfg = self.cfg
        hole_pos = {self.cards[cid].pos if cid else LINEUP_SLOTS[i] for i, (cid, _) in enumerate(self.lineup()) if cid is None or cid.startswith("N-")}
        untrained = [cid for cid in self.owned if cid not in self.inst]
        if untrained:
            untrained.sort(key=lambda cid: (self.cards[cid].pos in hole_pos,
                                            RARITIES.index(self.cards[cid].rarity) if self.cards[cid].rarity in RARITIES else -1), reverse=True)
            pick = untrained[0]
        else:
            cands = []
            for cid, rec in self.inst.items():
                pending = cid in self.pending_retrain
                if rec[1] >= cfg["retrain_max"] and not pending:
                    continue
                cands.append((pending, RARITIES.index(self.cards[cid].rarity) if self.cards[cid].rarity in RARITIES else -1, -rec[1], cid))
            if not cands:
                return False
            cands.sort(reverse=True)
            pick = cands[0][3]
        card = self.cards[pick]
        mu = card.expected_grad_ovr(cfg, self.owned.get(pick, 0)) + self.supporter_bonus()
        o = self.rng.gauss(mu, cfg["ovr_sigma"])
        rec = self.inst.get(pick)
        if rec is None:
            self.inst[pick] = [o, 1]
        else:
            rec[0] = max(rec[0], o); rec[1] += 1
        self._lineup_cache = None
        self.pending_retrain.discard(pick)
        self.grads += 1
        g = cfg["grad_gold"][grade_of(o)]
        self.gold += g
        self.income["육성 졸업 골드"] += g
        if not self.first_grad_given:
            self.first_grad_given = True
            self.tickets += cfg["first_grad_ticket"]
            self.income["첫 완주"] += cfg["first_grad_ticket"]
        if not cfg["proto_rules"]:
            for k, v in cfg["grad_milestones"].items():
                if self.grads >= k and k not in self.milestones_given:
                    self.milestones_given.add(k)
                    self.tickets += v
                    self.income["육성 마일스톤"] += v
        return True

    def train_phase(self, n):
        for _ in range(n):
            if not self.train_one():
                break

    # ---------- 경기 보상 ----------
    def reward_match(self, won, sets_won, home):
        cfg = self.cfg
        if cfg["proto_rules"]:
            if won:
                self.tickets += 1
                self.income["승리"] += 1
            else:
                self.frag += 1
                if self.frag >= 3:
                    self.frag -= 3
                    self.tickets += 1
                    self.income["패배 조각→티켓"] += 1
            return
        self.frag += cfg["match_shards"] + (cfg["win_shards"] if won else 0)
        while self.frag >= cfg["shards_per_ticket"]:
            self.frag -= cfg["shards_per_ticket"]
            self.tickets += 1
            self.income["경기 조각→티켓"] += 1
        gold = cfg["match_gold"] + cfg["set_gold"] * sets_won + (cfg["home_gold"] if home else 0)
        if won:
            gold += cfg["win_gold"]
        self.gold += gold
        self.income["경기 골드"] += gold

    # ---------- 시즌 ----------
    def play_series(self, a, b, bestof, clubs, advantage=0):
        """a = 상위 시드(홈 우선). advantage = a 가 미리 갖고 시작하는 승수(챔프전 정규 1위 우대)."""
        need = bestof // 2 + 1
        wa, wb = advantage, 0
        game = 0
        while wa < need and wb < need:
            home = a if game % 2 == 0 else b
            other = b if home == a else a
            oh = self.lineup_ovr() if home == "me" else clubs[home]
            oa = self.lineup_ovr() if other == "me" else clubs[other]
            h, s = play_match(self.rng, oh, oa, self.cfg)
            w = home if h > s else other
            if w == a:
                wa += 1
            else:
                wb += 1
            if "me" in (a, b):
                mine = w == "me"
                self.reward_match(mine, h if home == "me" else s, home == "me")
                if mine:
                    self.po_wins += 1
            game += 1
        return a if wa > wb else b

    def play_season(self, season):
        cfg = self.cfg
        self.season_idx = season
        self._lineup_cache = None
        g = min(cfg["ladder_cap"], cfg["ladder"][min(season - 1, len(cfg["ladder"]) - 1)])
        ovr_table = club_ovr_table(self.players, {t: min(1.0, g + cfg["club_g_offset"][t]) for t in CLUB_NAMES})
        # A.3.5 결원은 "졸업시켜 대표 인스턴스가 된 카드"에만 생긴다(엔진 departedCardIds = state.instances 기준).
        # 보유만 하고 아직 안 키운 카드는 원소속 구단에서 계속 뛴다.
        vac_delta = cfg["vacancy_ovr_delta"] if cfg["vacancy"] else 0.0
        departed = set(self.inst) if cfg["vacancy"] else None
        clubs = club_strength_now(ovr_table, departed, vac_delta)
        me = "me"
        teams = [me] + sorted(clubs)
        sched = round_robin_schedule(teams, self.rng)
        table = {t: dict(pts=0, w=0, l=0, sw=0, sl=0) for t in teams}
        trainings = 0
        holes_md, ovr_md = {}, {}
        income_before = Counter(self.income)
        pulls_before = self.pulls
        if season == 1:
            if cfg["tutorial_sr_setter"] and not cfg["proto_rules"]:
                self.receive_card(self.rng.choice(self.by_rarity_pos[("SR", "S")]), season, 0, count_pull=False)
            self.scout_phase(season, 0)
            self.train_phase(cfg["preseason_trainings"])
            trainings += cfg["preseason_trainings"]
        for md, rd in enumerate(sched, start=1):
            if cfg["daily_ticket"]:
                v = cfg["daily_ticket"] * cfg["days_per_matchday"]
                self.tickets += v; self.income["일일 미션"] += v
            if cfg["weekly_ticket"] and md % 7 == 0:
                self.tickets += cfg["weekly_ticket"]; self.income["주간 미션"] += cfg["weekly_ticket"]
            self.scout_phase(season, md)
            self.limit_break_phase()
            self.train_phase(cfg["trainings_per_matchday"])
            trainings += cfg["trainings_per_matchday"]
            if cfg["vacancy"]:
                # 이번 매치데이에 새로 졸업시킨 선수가 있으면 원소속 구단이 그만큼 약해진다
                clubs = club_strength_now(ovr_table, set(self.inst), vac_delta)
            holes_md[md] = self.holes()
            ovr_md[md] = self.lineup_ovr()
            my_ovr = ovr_md[md]
            for home, away in rd:
                oh = my_ovr if home == me else clubs[home]
                oa = my_ovr if away == me else clubs[away]
                h, a = play_match(self.rng, oh, oa, cfg)
                pw, pl = cfg["points_rule"][f"{max(h, a)}-{min(h, a)}"]
                win, lose = (home, away) if h > a else (away, home)
                table[win]["pts"] += pw; table[lose]["pts"] += pl
                table[win]["w"] += 1; table[lose]["l"] += 1
                table[home]["sw"] += h; table[home]["sl"] += a
                table[away]["sw"] += a; table[away]["sl"] += h
                if me in (home, away):
                    won = win == me
                    self.reward_match(won, h if home == me else a, home == me)
                    if won and self.first_win is None:
                        self.first_win = (season, md, trainings)
        # 순위: 승점 → 승수 → 세트 득실률 → (동률) 시드 난수
        order = sorted(teams, key=lambda t: (table[t]["pts"], table[t]["w"], table[t]["sw"] / max(1, table[t]["sl"]), self.rng.random()), reverse=True)
        rank = order.index(me) + 1
        po = order[:cfg["playoff_teams"]]
        in_po = me in po
        self.po_wins = 0
        if in_po and not cfg["proto_rules"]:
            self.tickets += cfg["playoff_entry_ticket"]; self.income["포스트시즌 진출"] += cfg["playoff_entry_ticket"]
        w34 = self.play_series(po[2], po[3], cfg["semi_bestof"], clubs)
        w2 = self.play_series(po[1], w34, cfg["po_bestof"], clubs)
        champion = self.play_series(po[0], w2, cfg["final_bestof"], clubs, cfg["final_advantage"])
        if not cfg["proto_rules"]:
            self.tickets += cfg["playoff_win_ticket"] * self.po_wins
            self.income["포스트시즌 승리"] += cfg["playoff_win_ticket"] * self.po_wins
            if champion == me:
                self.tickets += cfg["champion_ticket"]; self.gold += cfg["champion_gold"]
                self.income["우승"] += cfg["champion_ticket"]
            self.tickets += cfg["rank_tickets"][rank - 1]; self.income["순위 보상"] += cfg["rank_tickets"][rank - 1]
            self.gold += cfg["rank_gold"][rank - 1]; self.income["순위 골드"] += cfg["rank_gold"][rank - 1]
        if in_po and self.first_final4 is None:
            self.first_final4 = season
        if champion == me and self.first_title is None:
            self.first_title = season
        inc = Counter(self.income); inc.subtract(income_before)
        self.stats_by_season.append(dict(
            season=season, g=g, rank=rank, wins=table[me]["w"], pts=table[me]["pts"], in_po=in_po, champion=champion == me,
            pulls=self.pulls - pulls_before, tickets_in={k: v for k, v in inc.items() if "골드" not in k},
            rar=Counter(r for s, m, r, d in self.pull_log if s == season), dups=sum(1 for s, m, r, d in self.pull_log if s == season and d),
            ovr_start=ovr_md[1], ovr_mid=ovr_md[7], ovr_end=ovr_md[14],
            holes_start=holes_md[1], holes_mid=holes_md[7], holes_end=holes_md[14],
            lb=self.lb_count - self.lb_prev, gold=self.gold, trainings=trainings,
            club_avg=mean(clubs.values()), club_max=max(clubs.values()), club_min=min(clubs.values()),
        ))
        self.lb_prev = self.lb_count


def simulate(cfg, n, seed, pool, players):
    runs = []
    for i in range(n):
        r = Run(seed * 1000003 + i * 7919 + 17, pool, players, cfg)
        for s in range(1, cfg["seasons"] + 1):
            r.play_season(s)
        runs.append(r)
    return runs


def report_seasons(runs, cfg, label):
    S = cfg["seasons"]
    n = len(runs)
    print(f"\n### {label}\n")
    print(f"(n={n}, 매치데이당 육성 {cfg['trainings_per_matchday']}회 + 시즌 1 프리시즌 {cfg['preseason_trainings']}회, 육성 정책 오프셋 {cfg['policy_offset']:+.1f})\n")
    print("| 시즌 | g | 6구단 OVR 평균(최약~최강) | 내 라인업 OVR 개막/중반/종료 | 연습생·N 슬롯 개막/중반/종료 | 정규 승률 | 순위 분포 % (1/2/3/4/5/6/7) | 4강 | 우승 | 스카우트 | 획득 R/SR/SSR (중복) | 한계돌파 |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for s in range(S):
        rows = [r.stats_by_season[s] for r in runs]
        ranks = Counter(x["rank"] for x in rows)
        rar = Counter()
        for x in rows:
            rar.update(x["rar"])
        print(f"| {s + 1} | {rows[0]['g'] * 100:.0f}% | {mean(x['club_avg'] for x in rows):.1f} ({mean(x['club_min'] for x in rows):.1f}~{mean(x['club_max'] for x in rows):.1f}) "
              f"| {mean(x['ovr_start'] for x in rows):.1f} / {mean(x['ovr_mid'] for x in rows):.1f} / {mean(x['ovr_end'] for x in rows):.1f} "
              f"| {mean(x['holes_start'] for x in rows):.1f} / {mean(x['holes_mid'] for x in rows):.1f} / {mean(x['holes_end'] for x in rows):.1f} "
              f"| {100 * mean(x['wins'] for x in rows) / 12:.0f}% | {'/'.join(f'{100 * ranks[k] / n:.0f}' for k in range(1, 8))} "
              f"| {100 * mean(x['in_po'] for x in rows):.0f}% | {100 * mean(x['champion'] for x in rows):.0f}% "
              f"| {mean(x['pulls'] for x in rows):.1f} | {rar['R'] / n:.1f} / {rar['SR'] / n:.1f} / {rar['SSR'] / n:.2f} ({mean(x['dups'] for x in rows):.1f}) | {mean(x['lb'] for x in rows):.1f} |")
    allkeys = Counter()
    for r in runs:
        for x in r.stats_by_season:
            allkeys.update(x["tickets_in"])
    keys = [k for k, _ in allkeys.most_common()]
    print("\n티켓 수입 소스(시즌별 평균, 시즌 1 은 초기 지급 %d 별도):\n" % cfg["init_tickets"])
    print("| 시즌 | " + " | ".join(keys) + " | 합계 |")
    print("|---|" + "---|" * (len(keys) + 1))
    for s in range(S):
        rows = [r.stats_by_season[s] for r in runs]
        vals = [mean(x["tickets_in"].get(k, 0) for x in rows) for k in keys]
        print(f"| {s + 1} | " + " | ".join(f"{v:.1f}" for v in vals) + f" | {sum(vals):.1f} |")
    got = [r.first_ssr for r in runs if r.first_ssr]
    by_season = Counter(x[0] for x in got)
    line = "첫 SSR: " + ", ".join(f"S{s}까지 누적 {100 * sum(by_season[k] for k in range(1, s + 1)) / n:.0f}%" for s in range(1, S + 1))
    if got:
        line += f" · 스카우트 횟수 p10/p50/p90 = {pct([x[2] for x in got], 0.1):.0f} / {pct([x[2] for x in got], 0.5):.0f} / {pct([x[2] for x in got], 0.9):.0f}"
        s1 = [x[1] for x in got if x[0] == 1]
        if s1:
            line += f" · 시즌 1 안이면 매치데이 중앙값 {pct(s1, 0.5):.0f} (전반 ≤7: {100 * sum(1 for m in s1 if m <= 7) / n:.0f}%, 후반: {100 * sum(1 for m in s1 if m > 7) / n:.0f}%)"
    print("\n" + line)
    fw = [r.first_win for r in runs if r.first_win and r.first_win[0] == 1]
    print(f"첫 승리(시즌 1): 매치데이 p50 {pct([x[1] for x in fw], 0.5):.0f} (p90 {pct([x[1] for x in fw], 0.9):.0f}) · 그때까지 육성 p10/p50/p90 = {pct([x[2] for x in fw], 0.1):.0f} / {pct([x[2] for x in fw], 0.5):.0f} / {pct([x[2] for x in fw], 0.9):.0f}회 · 시즌 1 무승 {100 * (n - len(fw)) / n:.0f}%")
    f4 = Counter(r.first_final4 for r in runs)
    ft = Counter(r.first_title for r in runs)
    print("첫 4강 시즌: " + " / ".join(f"S{s} {100 * f4[s] / n:.0f}%" for s in range(1, S + 1)) + f" / 없음 {100 * f4[None] / n:.0f}%")
    print("첫 우승 시즌: " + " / ".join(f"S{s} {100 * ft[s] / n:.0f}%" for s in range(1, S + 1)) + f" / 없음 {100 * ft[None] / n:.0f}%")
    fill = []
    for r in runs:
        t = None
        for s, x in enumerate(r.stats_by_season, start=1):
            for k, md in (("holes_start", 1), ("holes_mid", 7), ("holes_end", 14)):
                if x[k] == 0 and t is None:
                    t = (s - 1) * 14 + md
        fill.append(t)
    gf = [x for x in fill if x]
    if gf:
        print(f"라인업 7슬롯 전부 정식 카드(연습생·N 없음): 누적 매치데이 p50 {pct(gf, 0.5):.0f} / p90 {pct(gf, 0.9):.0f} (14 = 시즌 1 종료) · {S}시즌 내 미도달 {100 * (n - len(gf)) / n:.0f}%")
    hole_pos = Counter()
    for r in runs:
        for i, (cid, _) in enumerate(r.lineup()):
            if cid is None or cid.startswith("N-"):
                hole_pos[LINEUP_SLOTS[i]] += 1
    print("최종 시점 잔여 구멍(연습생·N) 포지션별 슬롯 수: " + ", ".join(f"{p} {hole_pos[p] / n:.2f}" for p in POSITIONS))
    print(f"시즌 {S} 종료 라인업 OVR p10/p50/p90: {pct([r.lineup_ovr() for r in runs], 0.1):.1f} / {pct([r.lineup_ovr() for r in runs], 0.5):.1f} / {pct([r.lineup_ovr() for r in runs], 0.9):.1f} · "
          f"골드 잔액 {mean(r.gold for r in runs):.0f} · 조각 잔액 R/SR/SSR {mean(r.shards['R'] for r in runs):.0f}/{mean(r.shards['SR'] for r in runs):.0f}/{mean(r.shards['SSR'] for r in runs):.0f} · "
          f"포지션 지정 비율 {100 * sum(r.spent['포지션 지정 티켓'] for r in runs) / max(1, sum(r.pulls for r in runs)):.0f}%")


def report_pool(pool, players, cfg):
    print("\n### 카드 풀 기대 졸업 OVR (최적 정책·서포터 없음·핵심 61%/기타 36% 도달 — training-mode 12.1 에 피팅, 한계돌파 0 → 5)\n")
    print("| 포지션 | R (장수) | SR (장수) | SSR (장수) | N 폴백 |")
    print("|---|---|---|---|---|")
    for pos in POSITIONS:
        cells = []
        for rar in RARITIES:
            cs = [c for c in pool if c.pos == pos and c.rarity == rar]
            cells.append(f"{mean(c.expected_grad_ovr(cfg) for c in cs):.1f} → {mean(c.expected_grad_ovr(cfg, 5) for c in cs):.1f} ({len(cs)})" if cs else "— (0)")
        ncard = [c for c in pool if c.pos == pos and c.rarity == "N"][0]
        print(f"| {pos} | " + " | ".join(cells) + f" | {ncard.expected_grad_ovr(cfg):.1f} |")
    print("\n### 6구단 라인업 OVR (7명 포지션 가중 OVR 평균) — 성장률 g 사다리\n")
    print("| g | " + " | ".join(CLUB_NAMES[t] for t in sorted(CLUB_NAMES)) + " | 평균 |")
    print("|---|" + "---|" * 7)
    for g in [0.0, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 1.0]:
        cs = club_strength(players, {t: g for t in CLUB_NAMES})
        print(f"| {g * 100:.0f}% | " + " | ".join(f"{cs[t]:.1f}" for t in sorted(CLUB_NAMES)) + f" | {mean(cs.values()):.1f} |")


def report_pity(cfg, seed):
    """천장 규칙의 실효 확률 (뽑기만, 120,000회)."""
    print("\n### 천장 규칙의 실효 확률 (120,000회 뽑기, 기본 R 80 / SR 17 / SSR 3)\n")
    print("| 규칙 | 실효 등급 확률 | SSR 간격 평균 | SSR 간격 p50 / p90 / 최대 | SR+ 간격 p90 / 최대 |")
    print("|---|---|---|---|---|")
    for pity_sr, pity_ssr in ((10 ** 9, 10 ** 9), (10, 10 ** 9), (10, 60), (10, 50)):
        c = dict(cfg); c.update(pity_sr=pity_sr, pity_ssr=pity_ssr, proto_rules=False)
        r = Run(seed, [], [], c)
        cnt = Counter(); gaps = []; gaps_sr = []; last = 0; last_sr = 0
        N = 120000
        for i in range(1, N + 1):
            rar = r.roll_rarity()
            cnt[rar] += 1
            if rar == "SSR":
                gaps.append(i - last); last = i
            if rar != "R":
                gaps_sr.append(i - last_sr); last_sr = i
        lab = f"SR {pity_sr if pity_sr < 10 ** 9 else '없음'} / SSR {pity_ssr if pity_ssr < 10 ** 9 else '없음'}"
        print(f"| 천장 {lab} | R {100 * cnt['R'] / N:.1f}% / SR {100 * cnt['SR'] / N:.1f}% / SSR {100 * cnt['SSR'] / N:.2f}% | {mean(gaps):.1f} | {pct(gaps, 0.5):.0f} / {pct(gaps, 0.9):.0f} / {max(gaps)} | {pct(gaps_sr, 0.9):.0f} / {max(gaps_sr)} |")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=500)
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--seasons", type=int, default=3)
    ap.add_argument("--trainings", type=int, default=None,
                    help=f"매치데이당 육성 횟수 (기본 {DEFAULT_CFG['trainings_per_matchday']})")
    ap.add_argument("--only", default="", help="new|proto|general|live|safe|t2 중 하나만")
    ap.add_argument("--tutorial-setter", action="store_true",
                    help="튜토리얼 SR 세터 확정 지급을 켠다(엔진 미구현. 문서 v0.1 의 계획값 재현용)")
    ap.add_argument("--no-vacancy", action="store_true",
                    help="A.3.5 결원 보충을 끈다(문서 v0.1 의 '구단 로스터 고정' 가정 재현용)")
    args = ap.parse_args()
    n = 150 if args.quick else args.n
    t0 = time.time()
    players = load_players()
    cfg = dict(DEFAULT_CFG)
    cfg["seasons"] = args.seasons
    if args.trainings:
        cfg["trainings_per_matchday"] = args.trainings
    if args.tutorial_setter:
        cfg["tutorial_sr_setter"] = True
    if args.no_vacancy:
        cfg["vacancy"] = False
    pool = build_pool(players, cfg)
    print(f"# economy_sim — n={n}, seed={args.seed}, seasons={cfg['seasons']}")
    report_pool(pool, players, cfg)
    report_pity(cfg, args.seed)
    scenarios = []
    if args.only in ("", "new"):
        scenarios.append(("기준선 — 실제 엔진 상수 근사 (초기 5 · 경기 조각 2/승리 +4 · 순위/PO/마일스톤 · 천장 10/60 · 포지션 지정 · 중복 = 한계돌파 1단계 · 사다리 52/63/74% · 결원 −7.4 OVR)", dict(cfg)))
    if args.only in ("", "proto"):
        c = dict(cfg); c.update(proto_rules=True, init_tickets=5, init_gold=0, tutorial_sr_setter=False, scout_mode="general_only")
        scenarios.append(("현행 프로토타입 규칙 — 초기 5 · 승리 +1 · 패배 조각 1/3 · 천장 없음 · 일반만 · 중복 = 즉시 한계돌파", c))
    if args.only in ("", "general"):
        c = dict(cfg); c.update(scout_mode="general_only")
        scenarios.append(("신규 설계 − 포지션 지정 미사용 (일반 스카우트만)", c))
    if args.only in ("", "live"):
        c = dict(cfg); c.update(daily_ticket=1, weekly_ticket=3)
        scenarios.append(("신규 설계 + 정식 일일/주간 미션 (일 1 · 주 3)", c))
    if args.only in ("", "safe"):
        c = dict(cfg); c.update(policy_offset=-2.2)
        scenarios.append(("신규 설계 — 육성을 전부 자동(안전 정책, −2.2 OVR)", c))
    if args.only in ("", "t2"):
        c = dict(cfg); c.update(trainings_per_matchday=2)
        scenarios.append(("신규 설계 — 매치데이당 육성 2회 (라이트 유저)", c))
    for label, c in scenarios:
        report_seasons(simulate(c, n, args.seed, pool, players), c, label)
    print(f"\n(실행 {time.time() - t0:.1f}초)")


if __name__ == "__main__":
    main()
