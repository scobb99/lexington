"""Lexington economy simulation for Spec v3.0 (Section 6 evidence; Section 14 economy item).

Written by Claude for the v3.0 build, following the method Section 6 describes for Boone's
economy_sim_v3.py (that script was not in the project folder or the WordCity Drive folder when the
build ran, so this one re-implements the described method against the game's actual v3.0 rules).

Method (Section 6, "Simulation evidence"):
- racks drawn from the game's weighted bag (Section 5);
- the longest word the real dictionary allows from each rack, preferring a word outside the last
  10 submissions; among words of that length, one that plays through a stamped tile first;
- the rack refills as the game does; a dead rack is redrawn free;
- no happiness multiplier (LOCKED ruling 5 cut it): word rewards at face value;
- material separation: words pay Coins, Knowledge and Magic only;
- the Growing Rack: 6 tiles, 7 at the 2nd Cottage, 8 at the 4th;
- the trickle: 1 per connected producer per word (Sawmill Lumber, Quarry Stone, Market Coins);
- Workshop stamps: Oak (+4 Lumber), Granite (+4 Stone), Gilded (double the word's Coins), every
  3rd word per producer type, one of each kind held at a time;
- Commission orders: 3 open, posted by the build's own generator rules (the solvability table in
  src/data/orderSolvability.json, with the build's full-board fallback), each paying 5 to 12 of the
  largest-shortfall resource for the cheapest unbuilt building (Section 18 targeting); the model
  player uses the free discard on the order its rack is least likely to meet;
- the buy order of v2.0: 4 road tiles, a Cottage, 4 road tiles, a Sawmill, 6 road tiles, a Quarry,
  4 road tiles, four more Cottages, the Market when Tier 2 opens, then 20 more words; road tiles are
  bought as pieces at the summed prices (4 tiles = one 4-tile piece, 4 Coins; 6 tiles = two 3-tile
  pieces, 6 Coins);
- quest payouts on the path kept from v2.0 so the numbers compare (First Words 10 Coins, First Home
  10 Lumber, Working Town 15 Stone, A Growing Town 20 Coins), as Section 6 states.
Not modelled (so the model is slightly harder than the game): the High Street, the Reserve Shelf,
Lanterns, Swap spending, bridges, and the Rune.

Run from the project folder:  python3 scripts/boone/economy_sim_v3.py [sessions] [seed]
"""
import itertools
import json
import os
import random
import statistics
import sys
from collections import Counter, defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
WORDS_PATH = os.path.join(ROOT, 'src', 'data', 'words.txt')
SOLV = json.load(open(os.path.join(ROOT, 'src', 'data', 'orderSolvability.json')))

BAG = Counter({
    'E': 12, 'T': 9, 'A': 9, 'O': 8, 'I': 8, 'N': 7, 'S': 7, 'H': 6, 'R': 7,
    'D': 4, 'L': 4, 'U': 4, 'C': 3, 'M': 3, 'G': 3,
    'W': 2, 'F': 2, 'Y': 2, 'P': 2, 'B': 2, 'V': 2, 'K': 2,
    'J': 1, 'Q': 1, 'X': 1, 'Z': 1,
})
BAG_LIST = list(BAG.elements())
VOWELS = set('AEIOU')
RARE = set('JQXZKV')
RES = ['coins', 'lumber', 'stone', 'knowledge', 'magic']
START = {'coins': 20, 'lumber': 15, 'stone': 10, 'knowledge': 0, 'magic': 0}


def C(coins=0, lumber=0, stone=0, knowledge=0, magic=0):
    return {'coins': coins, 'lumber': lumber, 'stone': stone, 'knowledge': knowledge, 'magic': magic}


# Section 6 (v3.0) costs and the Tier 1 and 2 catalog the targeting rule reads.
COSTS = {
    'cottage': C(8, 4, 1), 'sawmill': C(15, 0, 4), 'quarry': C(15, 6, 0),
    'market': C(60, 20, 10), 'library': C(50, 15, 10), 'pier': C(40, 10, 0), 'scribe': C(40, 15, 5),
}
TIER = {'cottage': 1, 'sawmill': 1, 'quarry': 1, 'market': 2, 'library': 2, 'pier': 2, 'scribe': 2}
TRICKLE = {'sawmill': C(lumber=1), 'quarry': C(stone=1), 'market': C(coins=1)}
STAMP_OF = {'sawmill': 'oak', 'quarry': 'granite', 'market': 'gilded'}

BY_KEY = defaultdict(list)
with open(WORDS_PATH) as f:
    for line in f:
        w = line.strip().upper()
        if 3 <= len(w) <= 9:
            BY_KEY[''.join(sorted(w))].append(w)


def find_word(rack, recent, stamped_letters, min_len=3):
    """Longest word formable; prefers one outside the last 10, then one through a stamped tile."""
    letters = sorted(rack)
    for length in range(len(letters), min_len - 1, -1):
        seen = set()
        found = []
        for combo in itertools.combinations(range(len(letters)), length):
            key = ''.join(letters[i] for i in combo)
            if key in seen:
                continue
            seen.add(key)
            found.extend(BY_KEY.get(key, []))
        if found:
            fresh = [w for w in found if w not in recent] or found
            through = [w for w in fresh if any(ch in w for ch in stamped_letters)]
            return sorted(through or fresh)[0]
    return None


def word_reward(word, is_repeat, gilded):
    L = len(word)
    V = sum(1 for ch in word if ch in VOWELS)
    R = sum(1 for ch in word if ch in RARE)
    total = C(coins=max(2, L // 2), knowledge=-(-V // 2), magic=R)
    if gilded:
        total['coins'] *= 2
    if L >= 7:
        total['magic'] += 1
    if is_repeat:
        total = {k: v // 2 for k, v in total.items()}
    total['coins'] = max(1, total['coins'])
    return total


# ---- Section 18 orders, by the build's generator rules ----
TWICE = 'ESTRLOAN'
START_L = 'SCPTMBRLDG'
ALL_CONDS = ['len6', 'len7'] + [f'twice:{l}' for l in TWICE] + [f'start:{l}' for l in START_L] + ['rare', 'stamp']


def share(cond, size):
    return SOLV['results'][str(max(6, min(9, size)))].get(cond, 0)


def gated(size, producer):
    return [c for c in ALL_CONDS if not (c == 'len7' and size < 7) and not (c == 'stamp' and not producer)]


def pick_cond(rng, size, producer, taken):
    passing = [c for c in gated(size, producer) if share(c, size) >= SOLV['bar'] and c not in taken]
    pool = passing or sorted([c for c in gated(size, producer) if c not in taken], key=lambda c: -share(c, size))[:4]
    types = sorted(set(c.split(':')[0] for c in pool))
    t = rng.choice(types)
    return rng.choice([c for c in pool if c.split(':')[0] == t])


def meets(cond, word, used_stamp):
    if cond == 'len6':
        return len(word) >= 6
    if cond == 'len7':
        return len(word) >= 7
    if cond.startswith('twice:'):
        return word.count(cond[-1]) >= 2
    if cond.startswith('start:'):
        return len(word) >= 5 and word[0] == cond[-1]
    if cond == 'rare':
        return any(ch in RARE for ch in word)
    return used_stamp


def reward_res(res, tier, standing):
    cands = [b for b in COSTS if TIER[b] <= tier and standing[b] == 0]
    if not cands:
        return 'coins'
    target = min(cands, key=lambda b: (sum(COSTS[b][k] for k in ('coins', 'lumber', 'stone')), list(COSTS).index(b)))
    cost = COSTS[target]
    short = {k: max(0, cost[k] - res[k]) for k in ('coins', 'lumber', 'stone')}
    most = max(short.values())
    keys = [k for k in ('coins', 'lumber', 'stone') if (short[k] == most if most > 0 else True)]
    return max(keys, key=lambda k: (cost[k], -('coins', 'lumber', 'stone').index(k)))


QUEUE = [
    ('roads', 4), ('buy', 'cottage'), ('roads', 4), ('buy', 'sawmill'), ('roads', 6), ('buy', 'quarry'),
    ('roads', 4), ('buy', 'cottage'), ('buy', 'cottage'), ('buy', 'cottage'), ('buy', 'cottage'), ('buy', 'market'),
]


def rack_size(owned):
    c = owned['cottage']
    return 8 if c >= 4 else 7 if c >= 2 else 6


def has_word(rack, min_len=3):
    letters = sorted(rack)
    for length in range(len(letters), min_len - 1, -1):
        for combo in itertools.combinations(range(len(letters)), length):
            if ''.join(letters[i] for i in combo) in BY_KEY:
                return True
    return False


def run_session(rng):
    res = dict(START)
    knowledge_life = 0
    owned = Counter()
    rack = [rng.choice(BAG_LIST) for _ in range(6)]
    stamps = {}  # index in rack -> kind
    counters = Counter()
    recent = []
    queue = list(QUEUE)
    words = 0
    m = {}
    log = defaultdict(float)
    per_word_first20 = Counter()
    placements_at = {}
    placed = 0
    balances_at_30 = None
    peak = {'lumber': 0, 'stone': 0}
    coin_income = []  # coins from words + production per word
    orders = []
    since_discard = 0
    quests = set()
    magic_from_words = 0
    magic_words = None

    def tier():
        return 2 if (owned['cottage'] * 3 >= 15 and knowledge_life >= 25 and owned['sawmill'] and owned['quarry']) else 1

    def post():
        taken = {o['cond'] for o in orders}
        producer = owned['sawmill'] + owned['quarry'] + owned['market'] > 0
        cond = pick_cond(rng, rack_size(owned), producer, taken)
        orders.append({'cond': cond, 'res': reward_res(res, tier(), owned), 'amt': rng.randint(5, 12), 'at': words})

    def try_buy():
        nonlocal placed
        while queue:
            kind, arg = queue[0]
            if kind == 'roads':
                if res['coins'] < arg:
                    return
                res['coins'] -= arg
                log['coins_roads'] += arg
                queue.pop(0)
                continue
            if arg == 'market' and tier() < 2:
                return
            cost = COSTS[arg]
            if not all(res[r] >= cost[r] for r in RES):
                return
            for r in RES:
                res[r] -= cost[r]
            log['coins_buildings'] += cost['coins']
            owned[arg] += 1
            placed += 1
            queue.pop(0)
            m.setdefault(arg, words)
            # Section 5: the rack grows at once with the purchase
            while len(rack) < rack_size(owned):
                rack.append(rng.choice(BAG_LIST))
            if arg == 'cottage' and 'firstHome' not in quests:
                quests.add('firstHome')
                res['lumber'] += 10
            if owned['sawmill'] and owned['quarry'] and 'workingTown' not in quests:
                quests.add('workingTown')
                res['stone'] += 15
            if owned['cottage'] * 3 >= 15 and 'growingTown' not in quests:
                quests.add('growingTown')
                res['coins'] += 20

    while len(orders) < 3:
        post()
    try_buy()
    market_word = None
    while words < 400:
        if market_word is not None and words >= market_word + 20:
            break
        if not queue and 'market' not in m:
            break
        min_len = 4 if tier() >= 2 else 3
        stamped_letters = {rack[i] for i in stamps}
        word = find_word(rack, set(recent), stamped_letters, min_len)
        if word is None:
            rack = [rng.choice(BAG_LIST) for _ in range(len(rack))]
            # the build moves held stamps to the redrawn rack (an automatic redraw)
            stamps = {i: k for i, k in zip(range(len(rack)), stamps.values())}
            continue
        # which tiles the word uses (stamped tiles first, as a player aiming at the stamp does)
        need = Counter(word)
        used = []
        for i in sorted(range(len(rack)), key=lambda i: (i not in stamps, i)):
            if need[rack[i]] > 0:
                need[rack[i]] -= 1
                used.append(i)
        kinds = [stamps[i] for i in used if i in stamps]
        is_repeat = word in recent
        reward = word_reward(word, is_repeat, 'gilded' in kinds)
        words += 1
        made = C()
        for b, rate in TRICKLE.items():
            for r in RES:
                made[r] += rate[r] * owned[b]
        stamp_pay = C(lumber=4 * kinds.count('oak'), stone=4 * kinds.count('granite'))
        done = [o for o in orders if meets(o['cond'], word, bool(kinds))]
        order_pay = C()
        for o in done:
            order_pay[o['res']] += o['amt']
            log['orders_done'] += 1
        for r in RES:
            res[r] += reward[r] + made[r] + stamp_pay[r] + order_pay[r]
        knowledge_life += reward['knowledge'] + made['knowledge'] + order_pay['knowledge']
        magic_from_words += reward['magic']
        if magic_words is None and magic_from_words >= 10:
            magic_words = words
        log['coins_words'] += reward['coins']
        log['coins_orders'] += order_pay['coins']
        for r in ('lumber', 'stone'):
            log[f'{r}_trickle'] += made[r]
            log[f'{r}_stamps'] += stamp_pay[r]
            log[f'{r}_orders'] += order_pay[r]
        coin_income.append(reward['coins'] + made['coins'])
        if words <= 20:
            for r in RES:
                per_word_first20[r] += reward[r]
        if words == 3 and 'firstWords' not in quests:
            quests.add('firstWords')
            res['coins'] += 10
        recent = (recent + [word])[-10:]
        # refill: used tiles leave with their stamps, the rest keep theirs
        keep = [i for i in range(len(rack)) if i not in used]
        new_rack = [rack[i] for i in keep]
        new_stamps = {k: stamps[i] for k, i in enumerate(keep) if i in stamps}
        while len(new_rack) < rack_size(owned):
            new_rack.append(rng.choice(BAG_LIST))
        rack, stamps = new_rack, new_stamps
        if not has_word(rack, min_len):
            rack = [rng.choice(BAG_LIST) for _ in range(len(rack))]
            stamps = {i: k for i, k in zip(range(len(rack)), stamps.values())}
        # orders: replace completed ones; use the free discard on the least likely order
        for o in done:
            orders.remove(o)
        since_discard = min(5, since_discard + 1)
        while len(orders) < 3:
            post()
        if since_discard >= 5:
            worst = min(orders, key=lambda o: share(o['cond'], len(rack)))
            if share(worst['cond'], len(rack)) < SOLV['bar']:
                orders.remove(worst)
                post()
                since_discard = 0
        # stamps: each producer type's counter, cadence 3 with one building
        held = set(stamps.values())
        for b, kind in STAMP_OF.items():
            if not owned[b]:
                continue
            every = 2 if owned[b] >= 2 else 3
            counters[kind] = min(every, counters[kind] + 1)
            if counters[kind] >= every and kind not in held:
                free = [i for i in range(len(rack)) if i not in stamps]
                if free:
                    stamps[rng.choice(free)] = kind
                    counters[kind] = 0
        try_buy()
        if market_word is None and 'market' in m:
            market_word = m['market']
        log['min_coins'] = min(log.get('min_coins', 1e9), res['coins'])
        for r in ('lumber', 'stone'):
            peak[r] = max(peak[r], res[r])
        if words == 12:
            placements_at[12] = placed
        if words == 30:
            placements_at[30] = placed
            balances_at_30 = (res['lumber'], res['stone'])
    before = coin_income[max(0, (market_word or words) - 20):(market_word or words)]
    after = coin_income[(market_word or words):(market_word or words) + 20]
    return {
        'milestones': m, 'per_word_first20': per_word_first20, 'placements': placements_at,
        'balances30': balances_at_30, 'peak': peak, 'log': log, 'words': words,
        'coin_before': sum(before) / max(1, len(before)), 'coin_after': sum(after) / max(1, len(after)),
        'magic_words': magic_words, 'reached_market': 'market' in m,
    }


def main():
    sessions = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 20261122
    rng = random.Random(seed)
    runs = [run_session(rng) for _ in range(sessions)]
    med = lambda xs: statistics.median(xs) if xs else float('nan')
    mean = lambda xs: sum(xs) / len(xs) if xs else float('nan')
    print(f'Lexington v3.0 economy simulation: {sessions} sessions, seed {seed}\n')
    print('Average per word over the first 20 words, word rewards only:')
    for r in RES:
        print(f'  {r:9s} {mean([x["per_word_first20"][r] / 20 for x in runs]):.2f}')
    print('\nWords to each milestone, median (mean):')
    for b in ('cottage', 'sawmill', 'quarry', 'market'):
        xs = [x['milestones'][b] for x in runs if b in x['milestones']]
        print(f'  {b:8s} {med(xs):5.1f} ({mean(xs):.1f})  reached in {len(xs)}/{sessions}')
    for w in (12, 30):
        xs = [x['placements'].get(w, 0) for x in runs if w in x['placements']]
        print(f'Buildings placed by word {w}: median {med(xs)} (mean {mean(xs):.1f})')
    L = lambda k: mean([x['log'][k] for x in runs])
    print('\nCoin flow across the run (mean per session):')
    print(f'  from words {L("coins_words"):.0f}; from orders {L("coins_orders"):.0f} ({L("orders_done"):.1f} orders completed); '
          f'spent on roads {L("coins_roads"):.0f}; spent on buildings {L("coins_buildings"):.0f}; lowest balance {L("min_coins"):.1f}')
    print(f'  Coin income per word (words + production): {mean([x["coin_before"] for x in runs]):.2f} in the 20 words before the Market, '
          f'{mean([x["coin_after"] for x in runs]):.2f} in the 20 after')
    print('\nMaterial income across the run (mean per session):')
    for src in ('trickle', 'stamps', 'orders'):
        print(f'  {src:8s} Lumber {L("lumber_" + src):5.1f}  Stone {L("stone_" + src):5.1f}')
    b30 = [x['balances30'] for x in runs if x['balances30']]
    print(f'\nAt word 30 the median town holds {med([b[0] for b in b30])} Lumber and {med([b[1] for b in b30])} Stone;'
          f' the highest balance averages {mean([x["peak"]["lumber"] for x in runs]):.0f} Lumber and {mean([x["peak"]["stone"] for x in runs]):.0f} Stone.')
    mw = [x['magic_words'] for x in runs if x['magic_words']]
    print(f'Magic: 10 Magic from words in a mean of {mean(mw):.0f} words ({len(mw)}/{sessions} sessions got there).')
    q = med([x['milestones']['quarry'] for x in runs if 'quarry' in x['milestones']])
    mk = med([x['milestones']['market'] for x in runs if 'market' in x['milestones']])
    print(f'\nSection 14 targets: Quarry median {q} words (target 4 to 12): {"PASS" if 4 <= q <= 12 else "FAIL"}; '
          f'Market median {mk} words (target 20 to 35): {"PASS" if 20 <= mk <= 35 else "FAIL"}')


if __name__ == '__main__':
    main()
