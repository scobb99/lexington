"""Builds src/data/words.txt for WordCity (Build Spec v1.1, Section 5, Fork B).

Sources (both read from local files):
  1. SCOWL 2020.12.07, Debian "hunspell-en-us" build: en_US.aff + en_US.dic
     (Kevin Atkinson's Spell Checker Oriented Word Lists; permissive licence).
  2. Frequency filter: Tesseract OCR "eng" word list (eng.traineddata, lstm-word-dawg),
     which was built from frequent words in a large web-text crawl. Extract it with:
       combine_tessdata -u eng.traineddata eng.
       dawg2wordlist eng.lstm-unicharset eng.lstm-word-dawg tess_words.txt

Steps:
  a. Expand every SCOWL stem with its affix rules.
  b. Keep forms that also appear in the Tesseract web list (lower-case a-z only).
  c. Add back regular inflections (plural/-s, -ed, -ing, -er, -est) of every kept stem,
     so common inflections of known words are accepted.
  d. Keep 3 to 8 letters (the rack holds 8 letters), drop abbreviations with no vowel,
     Roman numerals, and the entries in blocklist.txt (abbreviations and slurs).

Usage: python3 -I build_words.py en_US.aff en_US.dic tess_words.txt ../../src/data/words.txt
"""
import os, re, sys, importlib.util

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('expand_lib', os.path.join(here, 'expand_lib.py'))
lib = importlib.util.module_from_spec(spec); spec.loader.exec_module(lib)

aff, dic, tess_path, out_path = sys.argv[1:5]
rules = lib.load_rules(aff)
tess = {w for w in open(tess_path, encoding='utf-8').read().split() if re.fullmatch(r'[a-z]+', w)}
block = set(open(os.path.join(here, 'blocklist.txt')).read().split()) - {'sat', 'sun', 'wed', 'mar', 'corps', 'admin', 'admins', 'anon'}
INFL = set('SDGRT')
ROMAN = re.compile(r'^m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$')
NO_VOWEL_OK = {'hmm', 'brr', 'shh', 'psst', 'tsk', 'tsks', 'nth', 'pfft', 'crypt', 'gym', 'gyms', 'myth', 'myths', 'lynx', 'hymn', 'hymns', 'shy', 'sky', 'fly', 'try', 'dry', 'cry', 'fry', 'pry', 'sly', 'spy', 'sty', 'wry', 'ply', 'why', 'by', 'my'}
ROMAN_OK = {'mix', 'mid', 'dim', 'lid', 'mild', 'civil', 'vivid', 'ill', 'mill', 'dill', 'civic'}

def keep_shape(w):
    if not re.fullmatch(r'[a-z]{3,8}', w): return False
    if not re.search(r'[aeiou]', w) and w not in NO_VOWEL_OK: return False
    if ROMAN.fullmatch(w) and w not in ROMAN_OK: return False
    return w not in block

kept, from_infl = set(), set()
for stem, flags in lib.read_dic(dic):
    stem_in_tess = stem in tess
    for form, via in lib.expand(stem, flags, rules):
        if form in tess: kept.add(form)
        elif stem_in_tess and via and set(via) <= INFL: from_infl.add(form)

final = sorted(w for w in kept | from_infl if keep_shape(w))
with open(out_path, 'w') as f: f.write('\n'.join(final) + '\n')
print(f'{len(final)} words written to {out_path}')
