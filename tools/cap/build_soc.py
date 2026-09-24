#!/usr/bin/env python3
"""會考社會題庫建置（v2.51）：心測中心官方 PDF → docs/v2/cap/soc/

沿用 build_en.py 的版面定位、答案表、裁圖函式。
依單元出題（家長 2026-09-24）：每題的「學習內容」課綱編碼（官方試題分析）→ tools/cap/soc_code_units.json
→ 升學王年級教材（不分版）的單元；一題多個編碼取最晚的單元。
  - 分科（歷史／地理／公民）＝編碼前綴；一組題目跨兩科（例：地歷）→ 不收（不知道另一科教到哪）
  - 沒有編碼、編碼查不到單元 → 不收（fail closed）
  - 題號集合必須等於官方答案表的 54 題，否則整年不收
"""
import csv, json, os, re, subprocess, sys, tempfile

sys.path.insert(0, os.path.dirname(__file__))
import build_en as B  # noqa: E402

OUT = os.environ.get('CAP_OUT', os.path.join(B.REPO, 'docs', 'v2', 'cap', 'soc'))
MAP = os.path.join(os.path.dirname(__file__), 'soc_code_units.json')
SYLLABUS = os.environ.get('CAP_SYLLABUS', os.path.join(os.path.dirname(B.DATA), '升學王教材', '年級教材', '年級教材總表.csv'))
YEARS = [int(y) for y in os.environ.get('CAP_YEARS', '112,113,114,115').split(',')]
VERSION = 1
STRANDS = {'歷': '歷史', '地': '地理', '公': '公民'}
GRADES = ['七上', '七下', '八上', '八下', '九上', '九下']


def ladders():
    """每科的單元順序：key＝「七上|序」，label＝「七上 1-2 選才、稅制與統治正當性」"""
    rows = list(csv.DictReader(open(SYLLABUS, encoding='utf-8-sig')))
    out = {}
    for code, name in STRANDS.items():
        rs = [r for r in rows if r['科目'] == name]
        rs.sort(key=lambda r: (GRADES.index(r['年級']), int(r['序'])))
        out[code] = [{'key': f"{r['年級']}|{r['序']}", 'label': f"{r['年級']} {r['課次']}".strip(), 'grade': r['年級']} for r in rs]
    return out


def analysis(year):
    """官方試題分析：每題的評量目標與學習內容編碼（依題號順序，數量必須是 54）"""
    t = subprocess.run(['pdftotext', '-layout', os.path.join(B.DATA, str(year), f'{year}_社會試題分析.pdf'), '-'],
                       capture_output=True, text=True, check=True).stdout
    goals = [re.sub(r'\s+', '', g) for g in re.findall(r'評量目標：([^\n]+)', t)]
    conts = re.findall(r'學習內容：([^\n]*)', t)
    if len(goals) != 54 or len(conts) != 54:
        return None
    out = {}
    for i, (g, c) in enumerate(zip(goals, conts)):
        # 官方分析有的寫全形「Ⅳ」、有的寫半形「IV」（reviewer H1：只認全形會把編碼默默丟掉 → 出太早）
        c = c.replace('IV', 'Ⅳ')
        parts = [x.strip() for x in re.split(r'[；;]', c) if x.strip()]
        codes = [f'{a}{m}' for a, m in re.findall(r'([歷地公])\s*([A-Z][a-z]-Ⅳ-\d+)', c)]
        # fail closed：有任何一段解析不出編碼（例：「歷 A-Ⅳ-1」單字母），這題就當作沒有編碼 → 不收
        if len(parts) != len(codes):
            codes = []
        out[i + 1] = {'goal': g, 'codes': codes}
    return out


def markers(pages):
    out = []
    for pi, pg in enumerate(pages):
        for l in B.content_lines(pg):
            t = l['text'].strip()
            if l['x0'] > B.LEFT_MAX:
                continue
            if (m := re.search(r'回答第\s*(\d{1,2})\s*[至～~-]\s*(\d{1,2})\s*題', t)):
                out.append({'kind': 'g', 'page': pi, 'y': l['y0'], 'a': int(m.group(1)), 'b': int(m.group(2))})
            elif (m := re.match(r'^(\d{1,2})\.(\s|$)', t)):
                out.append({'kind': 'q', 'page': pi, 'y': l['y0'], 'n': int(m.group(1)), 'x': l['x0']})
    xs = [round(m['x']) for m in out if m['kind'] == 'q']
    mode = max(set(xs), key=xs.count)
    return [m for m in out if m['kind'] != 'q' or abs(m['x'] - mode) <= 4]


# ---------- 依圖形位置裁切（v2.51）----------
# 社會科常見「題目在左、圖在右」而且圖比題號還高：只用題號的上下範圍切，會切掉圖頂、還會混到別題。
# 做法：用 PyMuPDF（本機既有，2026-09-02 已安裝，沒有新裝）讀每頁的文字行、向量圖形、圖片的位置，
# 每個元素依垂直中心歸到所屬的題；每題裁切＝自己所有元素的外框；框內屬於別題的元素塗白。
def norm_label(t):
    m = re.search(r'([圖表])\s*[\(（]\s*([一二三四五六七八九十0-9]{1,4})\s*[\)）]', t)
    return f'{m.group(1)}({m.group(2)})' if m else None


def smart_crops(pdf, segs_by_item, report_lines, item_text=None):
    item_text = item_text or {}
    import fitz  # noqa: WPS433
    doc = fitz.open(pdf)
    by_page = {}
    for iid, segs in segs_by_item.items():
        for k, (p, y0, y1) in enumerate(segs):
            by_page.setdefault(p, []).append((iid, k, y0, y1))
    out = {iid: [None] * len(segs) for iid, segs in segs_by_item.items()}
    owned_labels = {iid: set() for iid in segs_by_item}   # 自動檢查用：每題實際裁到的圖說
    sc = B.DPI / 72
    for p, owners in by_page.items():
        page = doc[p]
        W, H = page.rect.width, page.rect.height
        # 頁尾：這一頁的頁碼（純數字、在頁面最下方）以上才算內容；找不到就用預設
        nums_bottom = [fitz.Rect(ln['bbox']).y0 for bl in page.get_text('dict')['blocks'] for ln in bl.get('lines', [])
                       if re.fullmatch(r'\s*\d{1,2}\s*', ''.join(sp['text'] for sp in ln['spans'])) and ln['bbox'][1] > H - 90]
        footer_y = (min(nums_bottom) - 1) if nums_bottom else B.FOOTER_Y
        texts, graphics = [], []
        for bl in page.get_text('dict')['blocks']:
            if bl.get('type') == 1:
                graphics.append(fitz.Rect(bl['bbox']))
            for ln in bl.get('lines', []):
                texts.append(fitz.Rect(ln['bbox']))
        for d in page.get_drawings():
            r = fitz.Rect(d['rect'])
            if r.height > H * 0.5 or r.width > W * 0.85:   # 頁面裝飾（直線、外框）不算
                continue
            if r.x0 < -1 or r.y0 < -1 or r.x1 > W + 1 or r.y1 > H + 1:   # 超出頁面＝遮罩／裁切路徑，不是看得到的內容
                continue
            graphics.append(r)
        for im in page.get_image_info():
            graphics.append(fitz.Rect(im['bbox']))
        ok = lambda r: r.y0 < footer_y and not r.is_empty and r.width < W * 0.85
        # 大題標題（「二、題組：（44～54 題）」）不屬於任何一題
        hdr = [fitz.Rect(ln['bbox']) for bl in page.get_text('dict')['blocks'] for ln in bl.get('lines', [])
               if re.match(r'^\s*[一二三]、', ''.join(sp['text'] for sp in ln['spans']))]
        texts = [t for t in texts if not any(abs(t.y0 - h.y0) < 1 and abs(t.x0 - h.x0) < 1 for h in hdr)]
        texts, graphics = [r for r in texts if ok(r)], [r for r in graphics if ok(r)]
        # 跟圖說「圖(…)／表(…)」重疊的圖形是看不見的路徑或遮罩（例：114 第 6 頁跨過圖(十) 把兩張圖接在一起）→ 不算
        _cap_re = re.compile(r'^\s*[圖表]\s*[\(（][一二三四五六七八九十0-9]{1,4}[\)）]\s*$')
        _caps = [fitz.Rect(ln['bbox']) for bl in page.get_text('dict')['blocks'] for ln in bl.get('lines', [])
                 if _cap_re.match(''.join(sp['text'] for sp in ln['spans']))]
        graphics = [g for g in graphics if not any((g & fitz.Rect(c.x0 + 1, c.y0 + 1, c.x1 - 1, c.y1 - 1)).width > 0 and
                                                    (g & fitz.Rect(c.x0 + 1, c.y0 + 1, c.x1 - 1, c.y1 - 1)).height > 0 for c in _caps)]
        # 「橋」：上下跨過某個圖說、左右又緊貼它（20pt 內）的圖形——看不見的路徑，會把上下兩張圖串成一塊
        def is_bridge(g):
            for c in _caps:
                spans = g.y0 <= c.y0 + 3 and g.y1 >= c.y1 - 3
                near = max(c.x0 - g.x1, g.x0 - c.x1, 0) <= 20
                if spans and near and g.height > (c.height * 3):
                    return True
            return False
        graphics = [g for g in graphics if not is_bridge(g)]
        cap_re = re.compile(r'^\s*[圖表]\s*[\(（]')
        cap_rects = []
        for bl in page.get_text('dict')['blocks']:
            for ln in bl.get('lines', []):
                if cap_re.match(''.join(sp['text'] for sp in ln['spans'])):
                    cap_rects.append(fitz.Rect(ln['bbox']))
        def caption_between(a, b):
            # 有圖說夾在 a、b 兩個圖形之間（上下之間、左右重疊）→ 它們是兩張不同的圖，不合併
            lo, hi = (a, b) if a.y0 <= b.y0 else (b, a)
            for c in cap_rects:
                if c.y0 >= lo.y1 - 3 and c.y1 <= hi.y0 + 3 and min(c.x1, max(a.x1, b.x1)) - max(c.x0, min(a.x0, b.x0)) > 0:
                    return True
            return False
        # 1) 重疊或相鄰（6pt 內）的圖形合併成一張圖（一張圖表由很多小線段組成）；保留每個成員的位置
        groups = []   # [{'box': Rect, 'members': [Rect]}]
        for g in graphics:
            cur = {'box': fitz.Rect(g), 'members': [fitz.Rect(g)]}
            merged = True
            while merged:
                merged = False
                for other in groups:
                    ob = other['box']
                    if fitz.Rect(ob.x0 - 6, ob.y0 - 6, ob.x1 + 6, ob.y1 + 6).intersects(cur['box']) and not caption_between(ob, cur['box']):
                        cur['box'] |= ob
                        cur['members'] += other['members']
                        groups.remove(other)
                        merged = True
                        break
            groups.append(cur)
        # 2) 落在某個圖形成員裡面的文字（圖的標籤、刻度）跟著那張圖
        def inside(t, g):
            i = t & g
            return (not i.is_empty) and (i.width * i.height) >= 0.6 * (t.width * t.height)
        loose = []
        QTEXT_X = 120   # 題目本文從左邊（x≈65–92）開始；圖在右欄。從左欄開始的字一定是題目，不併進圖
        for t in texts:
            host = next((gr for gr in groups if any(inside(t, m) for m in gr['members'])), None)
            if host is None and t.x0 > QTEXT_X:
                host = next((gr for gr in groups if inside(t, gr['box'])), None)   # 圖外框裡的字（報紙內文、圖例）
            if host is None:
                loose.append(t)
            else:
                host['members'].append(t)
        last_owner = max(owners, key=lambda o: o[2])
        def owner_at(y):
            for o in owners:
                if o[2] - 2 <= y < o[3]:
                    return (o[0], o[1])
            # 這一頁最後一題的範圍只算到最後一行字；畫在更下面的選項圖（115 第 29、41 題）歸給最後一題（reviewer M2）
            if y >= last_owner[3] and y < footer_y:
                return (last_owner[0], last_owner[1])
            return None
        # 3) 歸屬：文字看自己的中心；圖先找緊貼的圖說「圖(…)／表(…)」（正下方或正上方 25pt 內、左右重疊），沒有才看中心
        page_lines = {}
        for bl in page.get_text('dict')['blocks']:
            for ln in bl.get('lines', []):
                page_lines[tuple(round(v, 1) for v in ln['bbox'])] = ''.join(sp['text'] for sp in ln['spans'])
        captions = [(fitz.Rect(bb), tx) for bb, tx in page_lines.items() if cap_re.match(tx)]
        # 圖說歸屬：題目文字提到「圖(十四)」的那一題（最可靠）；沒人提到才看圖說自己的位置
        page_iids = {o[0]: o for o in [(x[0], x[1]) for x in owners]}
        def caption_owner(cr, tx):
            lab = norm_label(tx)
            if lab:
                for iid_, own_ in page_iids.items():
                    body = item_text.get(iid_, '')
                    if lab in re.sub(r'[\s（]', lambda m: '(' if m.group(0) == '（' else '', body).replace('）', ')'):
                        return own_
            return owner_at((cr.y0 + cr.y1) / 2)
        cap_owner = {tuple(round(v, 1) for v in cr): caption_owner(cr, tx) for cr, tx in captions}
        elements = []   # (外框, 成員, 歸屬)
        for t in loose:
            key = tuple(round(v, 1) for v in t)
            elements.append((t, [t], cap_owner.get(key) or owner_at((t.y0 + t.y1) / 2)))
        for gr in groups:
            b = gr['box']
            # 考卷慣例：「圖(…)」圖說在圖的下方；「表(…)」標題在表格上方 → 只往對的方向找
            cap, best = None, None
            for cr, tx in captions:
                if min(cr.x1, b.x1) - max(cr.x0, b.x0) <= 0:
                    continue
                is_table = tx.strip().startswith('表')
                if b.contains(cr):
                    gap = 0
                elif not is_table and cr.y0 >= b.y1 - 3:
                    gap = cr.y0 - b.y1
                elif is_table and cr.y1 <= b.y0 + 3:
                    gap = b.y0 - cr.y1
                else:
                    gap = None
                if gap is not None and -3 <= gap <= 70 and (best is None or gap < best):
                    cap, best = cr, gap
            own = cap_owner.get(tuple(round(v, 1) for v in cap)) if cap else owner_at((b.y0 + b.y1) / 2)
            elements.append((b, gr['members'], own))
        if os.environ.get('CAP_DEBUG') == f'{os.path.basename(pdf)}:{p}':
            for bx, members, o in elements:
                if len(members) > 1 or bx.width > 60:
                    print('DEBUG group', [round(v) for v in bx], len(members), o)
            print('DEBUG captions', [(tx, cap_owner.get(tuple(round(v, 1) for v in cr))) for cr, tx in captions])
        for (cr, tx) in captions:
            o = cap_owner.get(tuple(round(v, 1) for v in cr))
            if o and norm_label(tx):
                owned_labels[o[0]].add(norm_label(tx))
        for iid, k, y0, y1 in owners:
            mine = [e for e in elements if e[2] == (iid, k)]
            if not mine:
                continue
            box = fitz.Rect(B.MARGIN, min(e[0].y0 for e in mine) - 3, W - B.MARGIN, min(footer_y, max(e[0].y1 for e in mine) + 3))   # 不超過頁尾（頁碼）
            pix = page.get_pixmap(matrix=fitz.Matrix(sc, sc), clip=box, colorspace=fitz.csGRAY)
            orig = page.get_pixmap(matrix=fitz.Matrix(sc, sc), clip=box, colorspace=fitz.csGRAY)   # 同一塊再渲染一次當原圖
            to_ir = lambda r: fitz.IRect(int(r.x0 * sc) - 1, int(r.y0 * sc) - 1, int(r.x1 * sc) + 2, int(r.y1 * sc) + 2) & pix.irect
            masked = 0
            # 塗白別題的「個別成員」（不是整張圖的大外框，免得蓋到自己的字）
            for bx, members, o in elements:
                if o is None or o == (iid, k) or not bx.intersects(box):
                    continue
                for m in members:
                    ir = to_ir(m & box)
                    if not ir.is_empty and pix.set_rect(ir, (255,)):
                        masked += 1
            # 再把自己的內容從原圖貼回來（重疊處以自己為準）
            if masked:
                for bx, members, o in mine:
                    for m in members:
                        ir = to_ir(m & box)
                        if not ir.is_empty:
                            pix.copy(orig, ir)
                # 最後：別題的「文字行」一定要遮掉（自己的圖若是有透明外框的圖片，貼回時會把別題的字一起貼回來）
                for bx, members, o in elements:
                    if o is None or o == (iid, k) or len(members) != 1 or bx not in texts or not bx.intersects(box):
                        continue
                    ir = to_ir(bx & box)
                    if not ir.is_empty:
                        pix.set_rect(ir, (255,))
            name = f'v{VERSION}-{iid}-{k + 1}.webp'
            with tempfile.TemporaryDirectory() as td:
                png = os.path.join(td, 'c.png')
                pix.save(png)
                B.run(['cwebp', '-quiet', '-q', '60', png, '-o', os.path.join(OUT, 'img', name)])
            out[iid][k] = name
            if masked:
                report_lines.append(f'{iid}-{k + 1} 遮白 {masked} 個別題元素')
    return out, owned_labels


def build_year(year, lad, cmap, report):
    pdf = os.path.join(B.DATA, str(year), f'{year}_社會.pdf')
    pages = B.bbox_pages(pdf)
    ans = B.grid_column(os.path.join(B.DATA, str(year), f'{year}_參考答案.pdf'), lambda t: t == '社會', r'[A-D]', 14)
    rates = {k: float(v) for k, v in B.grid_column(os.path.join(B.DATA, str(year), f'{year}_各題通過率.pdf'),
                                                   lambda t: t == '社會', r'[01]\.\d{2}', 26).items()}
    info = analysis(year)
    mk = markers(pages)
    qn = [m['n'] for m in mk if m['kind'] == 'q']
    if sorted(qn) != sorted(ans) or len(set(qn)) != len(qn) or not info:
        report.append(f'{year}: ✗ 題號／答案表／試題分析對不上 → 整年不收（題號 {len(qn)}、答案 {len(ans)}、分析 {"有" if info else "無"}）')
        return []
    in_group = lambda n: any(m['kind'] == 'g' and m['a'] <= n <= m['b'] for m in mk)
    bounds = [m for m in mk if m['kind'] == 'g' or (m['kind'] == 'q' and not in_group(m['n']))]
    idx = {c: {u['key']: i for i, u in enumerate(lad[c])} for c in lad}
    items, excluded = [], []
    all_segs = {}   # 每一項（含被排除的）的範圍都要記——別題的元素才遮得掉
    for i, m in enumerate(bounds):
        nxt = bounds[i + 1] if i + 1 < len(bounds) else None
        nums = list(range(m['a'], m['b'] + 1)) if m['kind'] == 'g' else [m['n']]
        iid = f'{year}-soc-{nums[0]:02d}' + (f'-{nums[-1]:02d}' if len(nums) > 1 else '')
        all_segs[iid] = B.regions(pages, m, nxt)
        codes = [c for n in nums for c in info[n]['codes']]
        strands = {c[0] for c in codes}
        if any(not info[n]['codes'] for n in nums):
            excluded.append(f'{iid}（有題目沒有課綱編碼）'); continue
        if len(strands) != 1:
            excluded.append(f'{iid}（跨科 {"".join(sorted(strands))}）'); continue
        s = strands.pop()
        miss = [c for c in codes if c not in cmap]
        if miss:
            excluded.append(f'{iid}（編碼沒有對照：{miss}）'); continue
        mu = max(idx[s][cmap[c]] for c in codes)
        segs = B.regions(pages, m, nxt)
        all_segs[iid] = segs
        text = B.region_text(pages, segs)
        qs = []
        for n in nums:
            ch = B.parse_choices(text, n)
            last = max(info[n]['codes'], key=lambda c: idx[s][cmap[c]])
            qs.append({'n': n, 'id': f'{year}-soc-{n:02d}', 'answer': ans[n], 'answerText': ch.get(ans[n]) if ch else None,
                       'goal': info[n]['goal'], 'pass': rates.get(n), 'codes': info[n]['codes'],
                       'review': {'unit': lad[s][idx[s][cmap[last]]]['label'], 'words': []}})
        imgs = None   # 下面整年一起依圖形位置裁切
        items.append({'id': iid, 'year': year, 'type': 'group' if len(nums) > 1 else 'single', 'strand': STRANDS[s],
                      'minUnit': lad[s][mu]['label'], 'minUnitIndex': mu, 'imgs': imgs, 'questions': qs,
                      'source': f'{year} 年國中教育會考 社會 第 {nums[0]}' + (f'–{nums[-1]}' if len(nums) > 1 else '') + ' 題（心測中心）'})
    notes = []
    # 題目文字（排除只有「圖(…)／表(…)」的圖說行，否則圖說剛好排在哪一題的高度就會被當成那題提到）
    cap_only = re.compile(r'^\s*[圖表]\s*[\(（][^\)）]{1,6}[\)）]\s*$')
    item_text = {iid: '\n'.join(l for l in B.region_text(pages, sg).split('\n') if not cap_only.match(l)) for iid, sg in all_segs.items()}
    crops, owned = smart_crops(pdf, all_segs, notes, item_text)
    # 自動檢查：題目提到的圖／表，裁切結果裡要有那張圖說；沒有就不收（fail closed）
    for it in items:
        body = re.sub(r'\s', '', item_text[it['id']]).replace('（', '(').replace('）', ')')
        refs = set(re.findall(r'(?<![代發列])[圖表]\([一二三四五六七八九十0-9]{1,4}\)', body))   # 排除「代表(人)」這類
        missing = refs - owned[it['id']]
        if missing:
            excluded.append(f"{it['id']}（圖說對不上：{sorted(missing)}）")
            it['imgs'] = []
    for it in items:
        if it['imgs'] == []:
            continue
        it['imgs'] = [f for f in crops[it['id']] if f]
    items = [it for it in items if it['imgs']]
    report.append(f'{year}: ✓ 收 {len(items)} 項（{sum(len(it["questions"]) for it in items)} 題），排除 {len(excluded)} 項：' + '、'.join(excluded))
    return items


def main():
    B.VERSION = VERSION
    os.makedirs(os.path.join(OUT, 'img'), exist_ok=True)
    for f in os.listdir(os.path.join(OUT, 'img')):
        os.remove(os.path.join(OUT, 'img', f))
    cmap = {k: v for k, v in json.load(open(MAP, encoding='utf-8')).items() if not k.startswith('_')}
    lad = ladders()
    for c, key in cmap.items():
        if key not in {u['key'] for u in lad[c[0]]}:
            raise SystemExit(f'對照表 {c} → {key} 不在升學王 {STRANDS[c[0]]} 單元清單')
    report, items = [], []
    for y in YEARS:
        items += build_year(y, lad, cmap, report)
    out = {'version': VERSION, 'subject': 'soc',
           'strands': {STRANDS[c]: [u['label'] for u in lad[c]] for c in lad},
           'strandGrades': {STRANDS[c]: [u['grade'] for u in lad[c]] for c in lad},
           'items': items,
           'note': '題目：國中教育會考歷屆試題（心測中心公開），依著作權法第 9 條不受保護；答案以心測中心參考答案為準；單元對照依官方試題分析的課綱學習內容編碼。'}
    used = {f for it in items for f in it['imgs']}
    for f in os.listdir(os.path.join(OUT, 'img')):
        if f not in used:
            os.remove(os.path.join(OUT, 'img', f))   # 被排除的題不上網站
    path = os.path.join(OUT, f'index.v{VERSION}.json')
    json.dump(out, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('\n'.join(report))
    print(f'輸出 {path}（{os.path.getsize(path)//1024} KB），圖片 {len(os.listdir(os.path.join(OUT, "img")))} 張')


if __name__ == '__main__':
    main()
