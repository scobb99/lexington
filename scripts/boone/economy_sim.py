#!/usr/bin/env python3
"""WordCity economy simulation (Spec v2.0, Section 6 evidence).

Plays simulated sessions with the game's real rules:
- racks drawn from the weighted letter bag in src/game/words.ts (total weight 120)
- the player submits the longest word findable from the rack in the real
  dictionary (build-verified/src/data/words.txt), preferring a word that is
  not in the last 10 submissions, so the repeat rule is modelled the way a
  real player avoids it
- used letters leave and the rack refills, exactly as the game does
- the happiness multiplier is 1.0 throughout (a starting town sits at 50-51)
- a dead rack redraws for free, per the dead rack rule

The session is a realistic first session and a start on the second:
  4 road tiles, Cottage, 4 road tiles, Sawmill, 6 road tiles, Quarry,
  4 road tiles, four more Cottages (population 15), then the Market as soon
  as Tier 2 unlocks (population 15, lifetime Knowledge 25, Sawmill and
  Quarry built). After the Market is bought the session plays 20 more words
  so Coin income per word can be compared before and after the first Coin
  production building stands.
Quest payouts on that path are included: First Words 10 Coins at 3 words,
First Home 10 Lumber at the first Cottage, Working Town 15 Stone when both
the Sawmill and the Quarry stand, A Growing Town 20 Coins at population 15.
Cross the River is excluded (the model builds no bridge), which makes the
model slightly harder than the real game.
Production pays on every word from every standing, road-connected building,
first three of a type at full rate and later ones at half rate, rounded down.

Run: python3 economy_sim.py [sessions]
"""
import itertools
import random
import statistics
import sys
from collections import Counter, defaultdict

WORDS_PATH = 'build-verified/src/data/words.txt'
BAG = Counter({
    'E': 12, 'T': 9, 'A': 9, 'O': 8, 'I': 8, 'N': 7, 'S': 7, 'H': 6, 'R': 7,
    'D': 4, 'L': 4, 'U': 4, 'C': 3, 'M': 3, 'G': 3,
    'W': 2, 'F': 2, 'Y': 2, 'P': 2, 'B': 2, 'V': 2, 'K': 2,
    'J': 1, 'Q': 1, 'X': 1, 'Z': 1,
})
BAG_LIST = list(BAG.elements())
VOWELS = set('AEIOU')
RARE = set('JQ XZKV'.replace(' ', ''))
START = {'coins': 20, 'lumber': 15, 'stone': 10, 'knowledge': 0, 'magic': 0}
RES = ['coins', 'lumber', 'stone', 'knowledge', 'magic']

BY_KEY = defaultdict(list)
with open(WORDS_PATH) as f:
    for line in f:
        w = line.strip().upper()  # the game normalizes the list to upper case too
        if 3 <= len(w) <= 8:
            BY_KEY[''.join(sorted(w))].append(w)


def find_word(rack_counter, recent):
    """Longest word formable from the rack; prefers one not in the last 10."""
    letters = sorted(rack_counter.elements())
    for length in range(len(letters), 2, -1):
        seen = set()
        found = []
        for combo in itertools.combinations(range(len(letters)), length):
            key = ''.join(letters[i] for i in combo)
            if key in seen:
                continue
            seen.add(key)
            words = BY_KEY.get(key)
            if words:
                found.extend(words)
        if found:
            fresh = [w for w in found if w not in recent]
            return sorted(fresh or found)[0]
    return None


def word_reward(word, stone_formula, is_repeat):
    L = len(word)
    V = sum(1 for ch in word if ch in VOWELS)
    R = sum(1 for ch in word if ch in RARE)
    total = {
        'coins': max(2, L // 2),
        'lumber': max(1, (L - V) // 3),
        'stone': stone_formula(L, V),
        'knowledge': -(-V // 2),
        'magic': R,
    }
    if L >= 7:
        total['magic'] += 1
    if is_repeat:
        total = {k: v // 2 for k, v in total.items()}
    total['coins'] = max(1, total['coins'])
    total['lumber'] = max(1, total['lumber'])
    return total


STONE_V1 = lambda L, V: (L - V) // 4
STONE_V2 = lambda L, V: max(1, (L - V) // 3)


def C(coins=0, lumber=0, stone=0, knowledge=0, magic=0):
    return {'coins': coins, 'lumber': lumber, 'stone': stone,
            'knowledge': knowledge, 'magic': magic}


RULESETS = {
    'v1 (as built)': {
        'stone': STONE_V1,
        'costs': {
            'cottage': C(10, 8, 0), 'sawmill': C(25, 12, 5),
            'quarry': C(25, 0, 15), 'market': C(60, 20, 10),
        },
        'production': {'sawmill': C(lumber=2), 'quarry': C(stone=2), 'market': C(coins=2)},
    },
    'v2 final (Quarry 25 Coins, 15 Lumber)': {
        'stone': STONE_V2,
        'costs': {
            'cottage': C(10, 8, 2), 'sawmill': C(25, 15, 0),
            'quarry': C(25, 15, 0), 'market': C(60, 20, 10),
        },
        'production': {'sawmill': C(lumber=3), 'quarry': C(stone=3), 'market': C(coins=4)},
    },
    'v2 variant (Quarry 30 Coins, 15 Lumber)': {
        'stone': STONE_V2,
        'costs': {
            'cottage': C(10, 8, 2), 'sawmill': C(25, 15, 0),
            'quarry': C(30, 15, 0), 'market': C(60, 20, 10),
        },
        'production': {'sawmill': C(lumber=3), 'quarry': C(stone=3), 'market': C(coins=4)},
    },
    'v2 final + Swap sink (6 Coins per 15 words)': {
        'stone': STONE_V2,
        'swap_sink': True,
        'costs': {
            'cottage': C(10, 8, 2), 'sawmill': C(25, 15, 0),
            'quarry': C(25, 15, 0), 'market': C(60, 20, 10),
        },
        'production': {'sawmill': C(lumber=3), 'quarry': C(stone=3), 'market': C(coins=4)},
    },
}

# (kind, name, coin cost of a road block) in purchase order.
QUEUE = [
    ('roads', 'roads A', 4), ('buy', 'cottage', 0),
    ('roads', 'roads B', 4), ('buy', 'sawmill', 0),
    ('roads', 'roads C', 6), ('buy', 'quarry', 0),
    ('roads', 'roads D', 4), ('buy', 'cottage', 0), ('buy', 'cottage', 0),
    ('buy', 'cottage', 0), ('buy', 'cottage', 0),
    ('buy', 'market', 0),
]


def run_session(rng, rules):
    costs = rules['costs']
    prod = rules['production']
    res = dict(START)
    lifetime_knowledge = 0
    rack = Counter(rng.choice(BAG_LIST) for _ in range(8))
    recent = []
    owned = Counter()
    queue = list(QUEUE)
    milestones = {}
    words = 0
    coins_from_words = 0
    coins_spent_roads = 0
    coins_spent_buildings = 0
    coins_spent_swap = 0
    min_coins = res['coins']
    per_word = Counter()
    magic_total = 0
    magic_words = None
    quests = {'firstWords': False, 'firstHome': False, 'workingTown': False, 'growingTown': False}
    post_market = None  # (coins at market word, coins 20 words later, word count)

    def tier2_open():
        return (owned['cottage'] * 3 >= 15 and lifetime_knowledge >= 25
                and owned['sawmill'] >= 1 and owned['quarry'] >= 1)

    def try_buy():
        nonlocal coins_spent_roads, coins_spent_buildings
        progressed = True
        while queue and progressed:
            progressed = False
            kind, name, road_coins = queue[0]
            if kind == 'roads':
                if res['coins'] >= road_coins:
                    res['coins'] -= road_coins
                    coins_spent_roads += road_coins
                    queue.pop(0)
                    progressed = True
            else:
                if name == 'market' and not tier2_open():
                    return
                cost = costs[name]
                if all(res[r] >= cost[r] for r in RES):
                    for r in RES:
                        res[r] -= cost[r]
                    coins_spent_buildings += cost['coins']
                    owned[name] += 1
                    queue.pop(0)
                    progressed = True
                    if name == 'cottage' and not quests['firstHome']:
                        res['lumber'] += 10
                        quests['firstHome'] = True
                    if name == 'cottage' and 'cottage' not in milestones:
                        milestones['cottage'] = words
                    if name == 'sawmill':
                        milestones['sawmill'] = words
                    if name == 'quarry':
                        milestones['quarry'] = words
                    if name == 'market':
                        milestones['market'] = words
                    if owned['sawmill'] >= 1 and owned['quarry'] >= 1 and not quests['workingTown']:
                        res['stone'] += 15
                        quests['workingTown'] = True
                    if owned['cottage'] * 3 >= 15 and not quests['growingTown']:
                        res['coins'] += 20
                        quests['growingTown'] = True

    try_buy()
    while words < 250:
        if not queue and post_market is None and 'market' in milestones:
            post_market = [res['coins'], words]
        if post_market is not None and words >= post_market[1] + 20:
            post_market.append(res['coins'])
            break
        if not queue and 'market' not in milestones:
            break
        word = find_word(rack, set(recent))
        if word is None:
            rack = Counter(rng.choice(BAG_LIST) for _ in range(8))
            continue
        words += 1
        reward = word_reward(word, rules['stone'], word in recent)
        for r in RES:
            res[r] += reward[r]
        coins_from_words += reward['coins']
        lifetime_knowledge += reward['knowledge']
        if words <= 20:
            for r in RES:
                per_word[r] += reward[r]
        magic_total += reward['magic']
        if magic_words is None and magic_total >= 10:
            magic_words = words
        # Production from standing buildings, first three of a type full rate.
        counts = Counter()
        for btype, amount in owned.items():
            if btype in prod:
                for i in range(amount):
                    counts[btype] += 1
                    rate = prod[btype]
                    half = counts[btype] > 3
                    for r in RES:
                        v = rate[r]
                        res[r] += v // 2 if half else v
                        if btype == 'market' and r == 'coins':
                            pass
        if words == 3 and not quests['firstWords']:
            res['coins'] += 10
            quests['firstWords'] = True
        if rules.get('swap_sink') and words % 15 == 0 and res['coins'] >= 6:
            res['coins'] -= 6  # a stuck player swaps about 3 tiles every 15 words
            coins_spent_swap += 6
        min_coins = min(min_coins, res['coins'])
        rack.subtract(Counter(word))
        rack = +rack
        while sum(rack.values()) < 8:
            rack[rng.choice(BAG_LIST)] += 1
        recent = (recent + [word])[-10:]
        try_buy()
        min_coins = min(min_coins, res['coins'])

    return {
        'milestones': milestones, 'per_word': per_word, 'words': words,
        'coins_from_words': coins_from_words, 'coins_spent_roads': coins_spent_roads,
        'coins_spent_buildings': coins_spent_buildings, 'coins_spent_swap': coins_spent_swap,
        'min_coins': min_coins,
        'magic_words': magic_words, 'post_market': post_market,
        'res_at_quarry': milestones.get('quarry'),
    }


def main():
    sessions = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    for name, rules in RULESETS.items():
        rng = random.Random(20261122)
        ms = defaultdict(list)
        pw = Counter()
        cfw, csr, csb, minc, magic, swap = [], [], [], [], [], []
        pre_coin_rate, post_coin_rate = [], []
        for _ in range(sessions):
            out = run_session(rng, rules)
            for k in ['cottage', 'sawmill', 'quarry', 'market']:
                ms[k].append(out['milestones'].get(k, 250))
            for r in RES:
                pw[r] += out['per_word'][r]
            cfw.append(out['coins_from_words'])
            csr.append(out['coins_spent_roads'])
            csb.append(out['coins_spent_buildings'])
            minc.append(out['min_coins'])
            swap.append(out['coins_spent_swap'])
            if out['magic_words']:
                magic.append(out['magic_words'])
            pm = out['post_market']
            if pm and len(pm) == 3:
                post_coin_rate.append((pm[2] - pm[0]) / 20)
        print(f'== {name} ({sessions} sessions)')
        print('   average per word, first 20 words, word rewards only: ' +
              ', '.join(f'{r} {pw[r] / (sessions * 20):.2f}' for r in RES))
        for k in ['cottage', 'sawmill', 'quarry', 'market']:
            vals = ms[k]
            print(f'   words to {k:8s}: mean {statistics.mean(vals):6.1f}  median {statistics.median(vals):5.0f}')
        print(f'   coin flow over the whole run: from words {statistics.mean(cfw):.0f} Coins; '
              f'spent on roads {statistics.mean(csr):.0f}, on buildings {statistics.mean(csb):.0f}, '
              f'on swaps {statistics.mean(swap):.0f}; lowest Coin balance seen, mean {statistics.mean(minc):.1f}')
        if magic:
            print(f'   words to earn 10 Magic from words alone: mean {statistics.mean(magic):.0f}')
        if post_coin_rate:
            print(f'   Coin income per word in the 20 words after the Market stands: {statistics.mean(post_coin_rate):.2f}')
        print()


if __name__ == '__main__':
    main()
