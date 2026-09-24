#!/usr/bin/env python3
"""會考英文題庫建置（v2.50）：心測中心官方 PDF → docs/v2/cap/en/

輸入（不在 repo 內，外接碟）：
  $CAP_DATA/<年>/<年>_英語閱讀.pdf、<年>_參考答案.pdf、<年>_各題通過率.pdf
  $CAP_DATA/../教育部/curr.txt（十二年國教英語文課綱 pdftotext，附錄五表一 1200 字）
輸出：
  docs/v2/cap/en/index.v<N>.json、docs/v2/cap/en/img/<年>-<編號>-<k>.webp

只用 python3 標準庫＋poppler（pdftotext／pdftoppm）＋cwebp，不需要安裝其他套件。

規則（規格 v1：TeenageStudyTool-Claude/specs/2026-09-24_會考統整題_規格_v1.md）：
  - 偵測到的題號必須等於官方答案表的題號，否則整年不收（fail closed）
  - 題組整組出；門檻以題組為單位（文章＋所有子題）
  - 依單元出題：已知字＝國小 1200＋課本到該單元＋該年級 CEFR（一年級 A1、二年級 A1＋A2），覆蓋率 ≥ 98%
  - 文字抽不到的題組（文章是圖片）不收
  - 答錯要提醒回去讀哪一單元：正確選項的字在哪一課教過；沒有的話取題目裡最晚教的字
"""
import json, os, re, subprocess, sys, tempfile

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DATA = os.environ.get('CAP_DATA', '/Volumes/X10-DATA/TeenageStudyTool/TeenageStudyTool-data/心測中心')
MOE = os.path.join(os.path.dirname(DATA), '教育部', 'curr.txt')
OUT = os.path.join(REPO, 'docs', 'v2', 'cap', 'en')
APPDATA = os.path.join(REPO, 'docs', 'v2', 'data')
YEARS = [int(y) for y in os.environ.get('CAP_YEARS', '112,113,114,115').split(',')]
VERSION = 1
DPI = 150
LEFT_MAX = 90          # 題號的 x 上限（pt）
FOOTER_Y = 755         # 頁尾（頁碼、「請翻頁繼續作答」）以下不收
MARGIN = 36            # 裁切左右邊界（pt）
COVERAGE = 0.98


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


# ---------- PDF 版面 ----------
def bbox_pages(pdf):
    with tempfile.NamedTemporaryFile(suffix='.html') as f:
        run(['pdftotext', '-bbox-layout', pdf, f.name])
        h = open(f.name, encoding='utf-8').read()
    pages = []
    for pg in h.split('<page ')[1:]:
        w, hgt = map(float, re.search(r'width="([\d.]+)" height="([\d.]+)"', pg).groups())
        lines = []
        for m in re.finditer(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</line>', pg, re.S):
            words = [(float(a), float(b), float(c), float(d), t) for a, b, c, d, t in
                     re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', m.group(5))]
            if not words:
                continue
            x0, y0, x1, y1 = map(float, m.groups()[:4])
            text = ' '.join(unescape(w[4]) for w in words)
            lines.append({'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1, 'text': text, 'words': words})
        lines.sort(key=lambda l: (round(l['y0']), l['x0']))
        pages.append({'w': w, 'h': hgt, 'lines': lines})
    return pages


def unescape(s):
    return s.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&#39;', "'")


def content_lines(page):
    return [l for l in page['lines'] if l['y0'] < FOOTER_Y]


# ---------- 官方答案與通過率 ----------
def grid_column(pdf, header_match, value_re, tol_x):
    """表格型 PDF（每格可能是獨立的一行）：找標頭欄的 x，再依每列題號的 y 取該欄的值"""
    out = {}
    for pg in bbox_pages(pdf):                     # 表格可能跨頁，每頁有自己的標頭
        words = [w for l in pg['lines'] for w in l['words']]
        head = [w for w in words if header_match(w[4])]
        if not head:
            continue
        cx = (head[0][0] + head[0][2]) / 2
        rows = [w for w in words if re.fullmatch(r'\d{1,2}', w[4]) and w[2] < cx - 30 and w[1] > head[0][3]]
        for r in rows:
            ry = (r[1] + r[3]) / 2
            cells = [w for w in words if re.fullmatch(value_re, w[4]) and abs((w[1] + w[3]) / 2 - ry) < 7]
            best = min(cells, key=lambda w: abs((w[0] + w[2]) / 2 - cx), default=None)
            if best and abs((best[0] + best[2]) / 2 - cx) < tol_x:
                out.setdefault(int(r[4]), best[4])
    return out


def answer_key(year):
    """參考答案表的「英語／閱讀」欄"""
    return grid_column(os.path.join(DATA, str(year), f'{year}_參考答案.pdf'), lambda t: t == '閱讀', r'[A-D]', 14)


def pass_rates(year):
    """各題通過率表的「英語(閱讀)」欄"""
    g = grid_column(os.path.join(DATA, str(year), f'{year}_各題通過率.pdf'), lambda t: '閱讀' in t, r'[01]\.\d{2}', 26)
    return {k: float(v) for k, v in g.items()}


def goals(year):
    """官方試題分析的「評量目標」，依題號順序（數量不是 43 就不用，fail closed）"""
    f = os.path.join(DATA, str(year), f'{year}_英語閱讀試題分析.pdf')
    if not os.path.exists(f):
        return {}
    t = run(['pdftotext', '-layout', f, '-']).stdout.decode('utf-8')
    g = [re.sub(r'\s+', '', x) for x in re.findall(r'評量目標：([^\n]+)', t)]
    return {i + 1: x for i, x in enumerate(g)} if len(g) == 43 else {}


# ---------- 題目定位 ----------
def markers(pages):
    """回傳依閱讀順序排好的標記：('q', n) 題號、('g', a, b) 題組、('sec', 名稱) 部分標題"""
    out = []
    for pi, pg in enumerate(pages):
        for l in content_lines(pg):
            t = l['text'].strip()
            if l['x0'] > LEFT_MAX:
                continue
            if re.match(r'^第[一二三]部分', t):
                out.append({'kind': 'sec', 'page': pi, 'y': l['y0'], 'text': t})
            elif (m := re.match(r'^\((\d{1,2})\s*[-–]\s*(\d{1,2})\)$', t)):
                out.append({'kind': 'g', 'page': pi, 'y': l['y0'], 'a': int(m.group(1)), 'b': int(m.group(2))})
            elif (m := re.match(r'^(\d{1,2})\.(\s|$)', t)):
                out.append({'kind': 'q', 'page': pi, 'y': l['y0'], 'n': int(m.group(1)), 'x': l['x0']})
    # 題號只認整份文件最常見的 x（±4pt）：文章裡的編號清單（例：115 第 5 頁「1. Pets are not allowed…」在 x=81）不是題號
    xs = [round(m['x']) for m in out if m['kind'] == 'q']
    if xs:
        mode = max(set(xs), key=xs.count)
        out = [m for m in out if m['kind'] != 'q' or abs(m['x'] - mode) <= 4]
    return out


def page_bottom(pg):
    ls = content_lines(pg)
    return max((l['y1'] for l in ls), default=FOOTER_Y) + 4


def page_top(pg):
    ls = content_lines(pg)
    return min((l['y0'] for l in ls), default=40) - 4


def regions(pages, start, end):
    """start、end＝標記；回傳 [(page, y0, y1)]，跨頁會切成多段"""
    segs = []
    p, y = start['page'], start['y'] - 4
    endp = end['page'] if end else len(pages) - 1
    endy = (end['y'] - 4) if end else page_bottom(pages[-1])
    while True:
        if p < endp:
            segs.append((p, y, page_bottom(pages[p])))
            p += 1
            y = page_top(pages[p])
        else:
            if endy - y > 8:
                segs.append((p, y, endy))
            break
    return [s for s in segs if s[2] - s[1] > 8]


def region_text(pages, segs):
    out = []
    for p, y0, y1 in segs:
        for l in content_lines(pages[p]):
            if y0 - 1 <= l['y0'] < y1:
                out.append(l['text'])
    return '\n'.join(out)


def crop(pdf, pages, segs, stem):
    files = []
    for k, (p, y0, y1) in enumerate(segs, 1):
        pg = pages[p]
        sc = DPI / 72
        x, w = MARGIN, pg['w'] - 2 * MARGIN
        name = f'v{VERSION}-{stem}-{k}.webp'   # 檔名帶版本：Service Worker 對圖片是 cache-first，重建一定要換版本號
        with tempfile.TemporaryDirectory() as td:
            base = os.path.join(td, 'c')
            run(['pdftoppm', '-f', str(p + 1), '-l', str(p + 1), '-r', str(DPI), '-gray', '-png', '-singlefile',
                 '-x', str(int(x * sc)), '-y', str(int(y0 * sc)), '-W', str(int(w * sc)), '-H', str(int((y1 - y0) * sc)),
                 pdf, base])
            run(['cwebp', '-quiet', '-q', '60', base + '.png', '-o', os.path.join(OUT, 'img', name)])
        files.append(name)
    return files


def parse_choices(text, n):
    """從「n. 題幹 (A) x (B) y (C) z (D) w」抽出四個選項文字（抽不到回 None）"""
    t = re.sub(r'\s+', ' ', text)
    m = re.search(rf'(?:^|\s){n}\.\s(.*?)(?=\s\d{{1,2}}\.\s|$)', t)
    body = m.group(1) if m else t
    parts = re.split(r'\(([A-D])\)', body)
    if len(parts) < 9:
        return None
    ch = {}
    for i in range(1, len(parts) - 1, 2):
        ch[parts[i]] = parts[i + 1].strip()
    return ch if set(ch) == set('ABCD') else None


# ---------- 字彙 ----------
IRR = set("""arose awoke bore beat became began bent bet bit bled blew broke brought built burnt bought caught chose came cost crept cut dealt dug did drew dreamt drank drove ate fell fed felt fought found fled flew forbade forgot forgave froze got gave went ground grew hung had heard hid hit held hurt kept knelt knew laid led leapt learnt left lent let lay lit lost made meant met paid put quit read rode rang rose ran said saw sought sold sent set shook shone shot showed shut sang sank sat slept slid spoke spent spun spread stood stole stuck stung struck swore swept swam swung took taught tore told thought threw understood woke wore wove wept won wound wrote
arisen awoken born beaten become begun bitten blown broken chosen come done drawn drunk driven eaten fallen flown forgotten forgiven frozen gotten given gone grown hidden known ridden rung risen run seen shaken shown sung sunk spoken stolen sworn swum taken torn thrown woken worn written children men women feet teeth mice people better best worse worst""".split())


def moe1200():
    L = open(MOE, encoding='utf-8').read().split('\n')
    a = next(i for i, l in enumerate(L) if '表一' in l and '1, 200' in l.replace('1,200', '1, 200'))
    b = next(i for i, l in enumerate(L) if '表二' in l and '800' in l)
    txt = re.sub(r'\b[A-Z]-\s', ' ', ' '.join(L[a:b]))
    return {t.lower().strip('.') for t in re.findall(r"[A-Za-z][A-Za-z'.]*", txt)}


def words_of(entries):
    s = set()
    for w in entries:
        s |= set(re.findall(r'[a-z]+', str(w.get('en', '')).lower()))
    return s


def unit_ladder():
    """app 的課本單元，依教學順序；每個單元附累積已知字"""
    meta = json.load(open(os.path.join(APPDATA, 'units-meta.json'), encoding='utf-8'))
    cefr = {}
    for lv in ('a1', 'a2'):
        d = json.load(open(os.path.join(APPDATA, f'cefr-{lv}.json'), encoding='utf-8'))
        cefr[lv] = set().union(*[words_of(v) for v in d.values() if isinstance(v, list)])
    base = moe1200() | IRR
    ladder, cum = [], set()
    for cat in meta['categories']:
        if not cat['id'].startswith('y'):
            continue
        grade2 = cat['id'].startswith('y2')
        for f in cat['files']:
            d = json.load(open(os.path.join(APPDATA, f), encoding='utf-8'))
            for unit, entries in d.items():
                if not isinstance(entries, list):
                    continue
                introduced = words_of(entries) - cum
                cum = cum | words_of(entries)
                known = base | cum | cefr['a1'] | (cefr['a2'] if grade2 else set())
                ladder.append({'unit': unit, 'known': known, 'introduced': introduced})
    return ladder


def stems(w):
    yield w
    for suf, reps in [('ies', ['y']), ('ied', ['y']), ('iest', ['y']), ('ier', ['y']), ('ily', ['y']), ('ing', ['', 'e']),
                      ('ed', ['', 'e']), ('es', ['', 'e']), ('s', ['']), ('ly', ['', 'le']), ('er', ['', 'e']),
                      ('est', ['', 'e']), ("'s", ['']), ('n', [''])]:
        if w.endswith(suf) and len(w) - len(suf) >= 2:
            b = w[:-len(suf)]
            for r in reps:
                yield b + r
            if len(b) > 2 and b[-1] == b[-2]:
                yield b[:-1]


def known(w, K):
    return any(x in K for x in stems(w))


def tokens(text, proper):
    return [w for w in re.findall(r"[a-z]+", text.lower()) if w not in proper and (len(w) > 1 or w in ('a', 'i'))]


def min_unit(text, proper, ladder):
    toks = tokens(text, proper)
    if len(toks) < 3:
        return None
    for i, u in enumerate(ladder):
        if sum(known(w, u['known']) for w in toks) / len(toks) >= COVERAGE:
            return i
    return None


def word_index(base):
    """字 → (單元, 中文)：課本單元優先，再來 A1／A2 單元（app 裡都有這些單元可以點進去複習）"""
    meta = json.load(open(os.path.join(APPDATA, 'units-meta.json'), encoding='utf-8'))
    idx = {}
    for cat in meta['categories']:
        for f in cat['files']:
            if not (f.startswith('textbook-') or f in ('cefr-a1.json', 'cefr-a2.json')):
                continue
            d = json.load(open(os.path.join(APPDATA, f), encoding='utf-8'))
            for unit, entries in d.items():
                if not isinstance(entries, list):
                    continue
                for e in entries:
                    en = str(e.get('en', '')).strip().lower()
                    # 課本單元的字都收（課本也教國小字）；A1／A2 單元只收國小 1200 以外的字
                    if not re.fullmatch(r"[a-z][a-z'-]*", en) or (not f.startswith('textbook-') and en in base):
                        continue
                    # CEFR 字的 zh 是 ECDICT 第一義，常常不是主要意思（v2.41 教訓）→ 有 meanings 就取第一個 meaning
                    zh = (e.get('meanings') or [{}])[0].get('zh') or e.get('zh', '')
                    idx.setdefault(en, (unit, str(zh).split('；')[0].split('，')[0].strip()))
    return idx


# 功能字（介系詞、連接詞、代名詞、疑問詞、助動詞、多義到沒辦法指一個意思的字）不當複習提示——那些是文法題
HINT_STOP = set('''a an the and but or so because if when while than then as of in on at to for from with by about into
over under after before like this that these those it its he she they we you i me him her them us my your his our their
mine yours what who whom whose which why how where there here be is am are was were been do does did have has had will
would can could shall should may might must not no yes one ones some any all both each every'''.split())


def same_stem(choices):
    """選項是同一個字的不同形態（give／gives／has given／gave）→ 文法題"""
    if not choices:
        return False
    sets = []
    for v in choices.values():
        st = set()
        for w in re.findall(r'[a-z]+', v.lower()):
            st |= set(stems(w)) | ({'give'} if w in ('gave', 'given') else set())
        sets.append(st)
    # 至少三個選項共用同一個字根（容得下一個不規則變化，例：was losing／is losing／will lose／has lost）
    from collections import Counter
    c = Counter(x for st in sets for x in st - HINT_STOP)
    return any(n >= 3 for n in c.values())


def review_hint(choice_text, question_text, proper, widx, choices=None):
    """答錯時的提醒：正確選項裡（沒有就整題）國小 1200 字以外、app 有教的字，指到它所在的單元"""
    def hits(text):
        out = []
        for w in tokens(text or '', proper):
            if w in HINT_STOP:
                continue
            for x in stems(w):
                if x in widx:
                    out.append((x, *widx[x]))
                    break
        return out
    # 閱讀理解題的答案是整句話，從句子挑字沒有意義 → 只有短答案（≤4 個字）才給複習單元
    if not choice_text or len(choice_text.split()) > 4:
        return None
    if same_stem(choices):   # 文法題（同一個字的不同形態）不指去背單字（reviewer M5）
        return None
    h = hits(choice_text)
    if not h:
        return None
    unit = h[-1][1] if not choice_text else h[0][1]
    words = []
    for w, u, zh in h:
        if u == unit and w not in [x['en'] for x in words]:
            words.append({'en': w, 'zh': zh})
    return {'unit': unit, 'words': words[:3]}


# ---------- 主流程 ----------
def build_year(year, ladder, widx, report):
    pdf = os.path.join(DATA, str(year), f'{year}_英語閱讀.pdf')
    pages = bbox_pages(pdf)
    ans = answer_key(year)
    rates = pass_rates(year)
    goal = goals(year)
    mk = markers(pages)
    qn = [m['n'] for m in mk if m['kind'] == 'q']
    if sorted(qn) != sorted(ans) or len(set(qn)) != len(qn):
        report.append(f'{year}: ✗ 題號 {sorted(set(qn))} ≠ 答案表 {sorted(ans)} → 整年不收')
        return []
    alltext = '\n'.join(l['text'] for pg in pages for l in content_lines(pg))
    caps = {w.lower() for w in re.findall(r"\b[A-Z][a-z]+", alltext)}
    lows = set(re.findall(r"\b[a-z]+", alltext))
    proper = caps - lows
    # 單元邊界：題組標頭、單題題號、部分標題
    bounds = [m for m in mk if m['kind'] in ('g', 'sec') or (m['kind'] == 'q' and not in_group(m['n'], mk))]
    items, excluded = [], []
    for i, m in enumerate(bounds):
        if m['kind'] == 'sec':
            continue
        nxt = bounds[i + 1] if i + 1 < len(bounds) else None
        segs = regions(pages, m, nxt)
        text = region_text(pages, segs)
        nums = list(range(m['a'], m['b'] + 1)) if m['kind'] == 'g' else [m['n']]
        iid = f'{year}-en-{nums[0]:02d}' + (f'-{nums[-1]:02d}' if len(nums) > 1 else '')
        if m['kind'] == 'g' and len(tokens(text, proper)) < 60:
            excluded.append(f'{iid}（文章可能是圖片，抽到的字太少）')
            continue
        mu = min_unit(text, proper, ladder)
        if mu is None:
            excluded.append(f'{iid}（任何單元都不到 98%）')
            continue
        qs = []
        for n in nums:
            ch = parse_choices(text, n)
            correct = ch.get(ans[n]) if ch else None
            qs.append({'n': n, 'id': f'{year}-en-{n:02d}', 'answer': ans[n], 'answerText': correct, 'goal': goal.get(n), 'pass': rates.get(n),
                       'review': review_hint(correct, text, proper, widx, ch)})
        imgs = crop(pdf, pages, segs, iid)
        items.append({'id': iid, 'year': year, 'type': 'group' if len(nums) > 1 else 'single',
                      'minUnit': ladder[mu]['unit'], 'minUnitIndex': mu, 'imgs': imgs, 'questions': qs,
                      'source': f'{year} 年國中教育會考 英語（閱讀）第 {nums[0]}' + (f'–{nums[-1]}' if len(nums) > 1 else '') + ' 題（心測中心）'})
    nq = sum(len(it['questions']) for it in items)
    report.append(f'{year}: ✓ 收 {len(items)} 項（{nq} 題），排除 {len(excluded)} 項：' + '、'.join(excluded))
    return items


def in_group(n, mk):
    return any(m['kind'] == 'g' and m['a'] <= n <= m['b'] for m in mk)


def main():
    os.makedirs(os.path.join(OUT, 'img'), exist_ok=True)
    for f in os.listdir(os.path.join(OUT, 'img')):
        os.remove(os.path.join(OUT, 'img', f))
    ladder = unit_ladder()
    widx = word_index(moe1200() | IRR)
    report, items = [], []
    for y in YEARS:
        items += build_year(y, ladder, widx, report)
    units = [u['unit'] for u in ladder]
    out = {'version': VERSION, 'subject': 'en', 'units': units, 'items': items,
           'note': '題目：國中教育會考歷屆試題（心測中心公開），依著作權法第 9 條不受保護；答案以心測中心參考答案為準（112–115 疑義均維持原答案）。'}
    path = os.path.join(OUT, f'index.v{VERSION}.json')
    json.dump(out, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('\n'.join(report))
    print(f'輸出 {path}（{os.path.getsize(path)//1024} KB），圖片 {len(os.listdir(os.path.join(OUT, "img")))} 張')


if __name__ == '__main__':
    main()
