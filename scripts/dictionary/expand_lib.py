import re
def load_rules(aff_path):
    rules = {}
    lines = open(aff_path, encoding='utf-8').read().splitlines(); i = 0
    while i < len(lines):
        p = lines[i].split()
        if len(p) == 4 and p[0] in ('PFX', 'SFX') and p[2] in ('Y', 'N'):
            kind, flag, cross, n = p[0], p[1], p[2] == 'Y', int(p[3]); ents = []
            for j in range(1, n + 1):
                q = lines[i + j].split()
                strip = '' if q[2] == '0' else q[2]; add = '' if q[3] == '0' else q[3].split('/')[0]
                cond = q[4] if len(q) > 4 else '.'
                ents.append((strip, add, re.compile(('^' + cond) if kind == 'PFX' else (cond + '$'))))
            rules[flag] = (kind, cross, ents); i += n + 1
        else: i += 1
    return rules
def read_dic(path):
    with open(path, encoding='utf-8') as f:
        next(f)
        for line in f:
            line = line.strip()
            if line:
                stem, _, flags = line.partition('/'); yield stem, flags
def _apply(word, flag, rules):
    kind, _, ents = rules[flag]; out = []
    for strip, add, rx in ents:
        if rx.search(word):
            if kind == 'SFX' and word.endswith(strip): out.append(word[:len(word) - len(strip)] + add)
            if kind == 'PFX' and word.startswith(strip): out.append(add + word[len(strip):])
    return out
def expand(stem, flags, rules):
    flags = [c for c in flags if c in rules]
    forms = [(stem, '')]; suff = []
    for s in [c for c in flags if rules[c][0] == 'SFX']:
        for w in _apply(stem, s, rules):
            forms.append((w, s))
            if rules[s][1]: suff.append((w, s))
    for p in [c for c in flags if rules[c][0] == 'PFX']:
        for w in _apply(stem, p, rules): forms.append((w, p))
        if rules[p][1]:
            for sw, s in suff:
                for w in _apply(sw, p, rules): forms.append((w, p + s))
    return forms
