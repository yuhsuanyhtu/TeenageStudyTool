// rules.js — 把獎金規則攤開講給孩子看
//
// 規則來源：reward.js 的 REWARD_CONFIG（金額自動跟著走，未來改設定不用改這裡）
// 改了哪一版本要更新規則時，動 RULES_VERSION_DATE 一個常數就好

import { REWARD_CONFIG, effectiveDailyCap, effectiveTuning, perCorrectFor } from './reward.js';
import { load as loadState } from './state.js';

const RULES_VERSION_DATE = '2026-09-05';  // v2.44

// v2.34：生活習慣扣款金額（跟家長頁 payout.js 的 DEFAULT_PENALTY 一致）
const HABIT_PENALTY = 10;

export function renderRules(root, onBack) {
  const cfg = REWARD_CONFIG;
  const tiers = cfg.streakTiers;
  // v2.35：每日上限家長可調（從 Sheet 同步到 state.dailyCap），規則頁永遠顯示目前生效的數字
  const st = loadState();
  const dailyCap = effectiveDailyCap(st.dailyCap);
  // v2.42：練習量模式（家長可切「加練」：複習 $10、連連看 $2、基礎門檻 10 題）
  const tune = effectiveTuning(st.practiceMode || 0);
  const isBoost = Number(st.practiceMode) === 1;

  root.innerHTML = `
    <button class="back" id="back">← 回主畫面</button>
    <h1>📋 規則</h1>
    <p class="muted">最後更新 ${RULES_VERSION_DATE}　·　要改規則會先跟你講</p>

    ${isBoost ? `
    <div class="card" style="border-left:4px solid #d4a85a;">
      <h3>⚡ 目前是「加練模式」（媽媽設定）</h3>
      <p class="muted small" style="margin-bottom:0;">升國二了，練習量要跟上會考。改變的只有三個：從頭複習變 $${tune.reviewBase}/天、連連看變 $${tune.matchReward}/場、基礎獎金要答對 ${tune.minCorrectForBase} 題。<b>答對一題還是 $2、連勝照舊答對 5 題就保住</b>——認真作答的錢一毛都沒少，少的是輕鬆錢。</p>
    </div>
    ` : ''}

    <div class="card">
      <h3>💰 怎麼賺錢</h3>
      <p>每天背單字就有錢拿，越認真錢越多。</p>

      <p style="margin-top:14px;"><b>① 基礎獎金：每天答對 ${tune.minCorrectForBase} 個以上 = $${cfg.base}</b></p>
      <p class="muted small">當天累積要答對 ${tune.minCorrectForBase} 個以上才有基礎獎，避免隨便玩兩下也拿錢。一天只給一次（不會每回都拿）。</p>

      <p style="margin-top:14px;"><b>② 表現加碼：每答對 1 個 = +$${cfg.perCorrect}；文意字彙 +$${perCorrectFor('vocab')}、克漏字每格 +$${perCorrectFor('cloze')}</b></p>
      <p class="muted small">題型越難、一題的錢越多（段考題型要讀句子、讀短文，比較費力）。沒有上限——但「基礎 + 加碼」一天最多 $${dailyCap}。每天背太多反而吸收不了，分散學比較有效。（這個數字媽媽可以調整，改了這裡會自動更新）</p>

      <p style="margin-top:14px;"><b>③ 連勝加成（最重要）</b></p>
      <table class="rules-table">
        <tr><td>連 ${tiers[0].days} 天</td><td><b>×${tiers[0].multiplier}</b></td></tr>
        <tr><td>連 ${tiers[1].days} 天</td><td><b>×${tiers[1].multiplier}</b></td></tr>
        <tr><td>連 ${tiers[2].days} 天</td><td><b>×${tiers[2].multiplier} 封頂</b></td></tr>
      </table>
      <p class="muted small" style="margin-top:8px;">當天賺到的錢乘以連勝倍率。連到 ${tiers[2].days} 天就滿級。</p>
    </div>

    <div class="card">
      <h3>🔁 同一題一天只領一次錢</h3>
      <p>錢是給「今天學到的東西」，不是給重複按的次數：</p>
      <p class="muted small" style="margin-bottom:4px;">· 英翻中／中翻英／文意字彙：<b>同一個字、同一種題型，一天只付一次</b>（例：apple 英翻中今天領過了，再答對不再給錢；但 apple 在中翻英還可以領，那是不同能力）。系統會<b>優先出你今天還沒領過的字</b>，題型卡上看得到「今天已領 N／總數」。</p>
      <p class="muted small" style="margin-bottom:4px;">· 連連看：同一個單元一天付一場。</p>
      <p class="muted small" style="margin-bottom:4px;">· 克漏字：同一篇一天付一次。閱讀練習：同一篇一天付一次。從頭複習：一天最多 $${tune.reviewDailyCap}。</p>
      <p class="muted small">領過的題目<b>還是可以練</b>，答對也照樣算進「基礎獎金」和「連勝」的題數，只是不再另外給錢。想賺更多就換單元、換題型——2,000 多個字等你。</p>
    </div>

    <div class="card">
      <h3>🛡️ 連勝中斷怎麼辦</h3>
      <p><b>每月送 3 張「保護卡」</b>。漏一天自動扣一張，連勝不會歸零。</p>
      <p class="muted small" style="margin-top:6px;">真的斷掉（保護卡用完）→ <b>只降一階，不歸零</b>。例：連 14 天斷掉 → 變回 7 天那階繼續算。讓你生病、考試週也不用怕全部白做。</p>
    </div>

    <div class="card">
      <h3>🎯 六種題型 + 一種閱讀</h3>
      <p style="margin-bottom:6px;">📖 <b>從頭複習</b> — 整課單字一張張看過，會幫你拼字母、唸發音，還有所有意思 + 近義字 + 反義字。走完整輪 +$${tune.reviewBase}（<b>一天最多領 $${tune.reviewDailyCap}</b>，再做沒獎金但仍可複習）</p>
      <p style="margin-bottom:6px;">🔗 <b>連連看</b> — 暖身用，每輪固定 +$${tune.matchReward}（很簡單可以刷，但獎金少）</p>
      <p style="margin-bottom:6px;">🇬🇧 → 🇹🇼 <b>英翻中</b> — 看英文選中文，4 選 1，題目上方會給英文例句（目標字加底線）。答對後可以展開看其他意思 + 同／反義字</p>
      <p style="margin-bottom:6px;">🇹🇼 → 🇬🇧 <b>中翻英</b> — 要拼出英文，難度最高，但學最深</p>
      <p style="margin-bottom:6px;">📝 <b>文意字彙</b>（老師推薦的段考題型）— 真實例句挖空，4 選 1 選出最適合的英文字。例句來自 Tatoeba 開放例句庫（每字最多 3 句、每次隨機出，句子的用字都在你學過的範圍）。選項會混一個基礎字，跟考卷一樣。答錯會告訴你「你選的字是什麼意思、為什麼不合」，而且那個字之後會優先再出現。每答對 <b>+$${perCorrectFor('vocab')}</b>（比英翻中多，因為要讀句子），也算「已會」的連對次數</p>
      <p style="margin-bottom:6px;">🧩 <b>克漏字</b>（老師推薦的段考題型）— 讀短文，每格 4 選 1，考時態、連接詞跟課文單字。短文取自 VOA Learning English（美國之音的免費英語教材）真實課文對話，看不懂的字下面有中文註解，還可以按「💬 看中文」看整段翻譯（看了還是要自己選）。每答對 1 格 <b>+$${perCorrectFor('cloze')}</b>；答錯會顯示你選的字的意思＋為什麼是正解。<b>同一篇一天只領一次獎金</b>（可以再練，錢明天再領）——把 13 篇都做過比背熟一篇划算</p>
      <p style="margin-bottom:6px;">📚 <b>閱讀練習</b> — 主畫面下方有「閱讀練習」按鈕，可以讀短文。點任何字就會看到中文意思。<b>讀完要做英文理解測驗，答對 1 題 +$${cfg.readingPerCorrect}</b>（3 題全對 = $15／篇，跟段考一樣是英文題目）。同一篇一天只能領一次。查過的字會自動進入記憶系統，讀完還可以一鍵「練習剛剛的生字」</p>
      <p class="muted small" style="margin-top:8px;">建議流程：先「從頭複習」過一輪 → 連連看暖身 → 英翻中認熟 → 中翻英拼字打底。讀短文當作休息一下換腦袋。</p>
      <p class="muted small">中翻英碰到「每一個英文都對」的字（例如 every / each 都是「每一」），系統會兩個都接受，不會誤判。</p>
    </div>

    <div class="card">
      <h3>🔢 題數選擇（英翻中／中翻英／文意字彙）</h3>
      <p>進入單元後，題型卡上方可以選題數：</p>
      <p style="margin-bottom:6px;"><b>8 題（快練）</b> — 預設，每天暖身用</p>
      <p style="margin-bottom:6px;"><b>半套</b> — 約一半單元字數，中量複習</p>
      <p style="margin-bottom:6px;"><b>全套</b> — 整個單元一次走完，考前複習用</p>
      <p class="muted small" style="margin-top:6px;">題數越多越累、但同一回拿的獎金也越多（每答對都 +$${cfg.perCorrect}，封頂 $${dailyCap}）。</p>
    </div>

    <div class="card">
      <h3>🌳 系統會記住你會的字</h3>
      <p>每個字系統都會偷偷記分：</p>
      <p style="margin-bottom:6px;">🌱 <b>沒見過</b> — 還沒練到</p>
      <p style="margin-bottom:6px;">🌿 <b>學習中</b> — 練過但還在記</p>
      <p style="margin-bottom:6px;">🌳 <b>已會</b> — 連續答對 3 次</p>

      <p style="margin-top:14px;"><b>怎麼累積 streak（連對次數）？</b></p>
      <table class="rules-table">
        <tr><td>🇬🇧 → 🇹🇼 英翻中</td><td>✅ 答對 +1、答錯歸 0</td></tr>
        <tr><td>🇹🇼 → 🇬🇧 中翻英</td><td>✅ 答對 +1、答錯歸 0</td></tr>
        <tr><td>📝 文意字彙</td><td>✅ 答對 +1、答錯歸 0（也是真考試）</td></tr>
        <tr><td>🧩 克漏字</td><td>❌ 考文法語感，不算單字 streak</td></tr>
        <tr><td>🔗 連連看</td><td>❌ 只算「看過」，不算 streak</td></tr>
        <tr><td>📖 從頭複習</td><td>❌ 同上（沒考試怎麼算對）</td></tr>
        <tr><td>📚 閱讀練習</td><td>❌ 只記查過的字</td></tr>
      </table>
      <p class="muted small" style="margin-top:6px;"><b>為什麼這樣設計</b>：只有真考試（會錯）才證明「真會」。連連看可亂點、複習只是翻看、閱讀只是查字。所以**字典裡的字保證考得過**。</p>

      <p class="muted small" style="margin-top:10px;">出題會優先抽：沒見過 + 學習中（變化多）、加上一點點答錯過的（讓你補弱點）。<b>已會的字不會再考</b>，省力。全部會了之後才會回頭測一次防忘記。</p>
      <p class="muted small">主畫面每個單元旁邊會顯示「🌳 N／總 已會」+ 進度條，看得到自己進步。</p>
      <p class="muted small">主畫面下方「🏆 我的字典」可以看自己學會了哪些字，每 50 字解鎖一個徽章（🥉 → 🥈 → 🥇 → 💎 → 👑）。</p>
    </div>

    <div class="card">
      <h3>📊 紀錄怎麼看</h3>
      <p class="muted small">主畫面顯示：今日獎金、可提領、已提領、連勝天數。</p>
      <p class="muted small">媽媽那邊有 Google Sheet 看得到每次練習的詳細紀錄（時間、答對幾題、賺了多少、查過哪些生字）。</p>
    </div>

    <div class="card">
      <h3>🏦 提領零用金</h3>
      <p>媽媽用特殊網址進「家長提領頁」，每次以 <b>$${cfg.payoutUnit}</b> 為單位。</p>
      <p class="muted small">提領後「可提領」會減少、「已提領」會增加。Google Sheet 也會留紀錄，多裝置會自動同步。</p>
    </div>

    <div class="card">
      <h3>🤝 生活習慣的約定</h3>
      <p>這是你跟媽媽一起講好的：<b>約定好、也提醒過的事</b>，如果還是沒做到，會從「可提領」扣 <b>$${HABIT_PENALTY}</b>。</p>
      <p class="muted small" style="margin-top:8px;">放心，這只會動到「可提領」的零用金：</p>
      <p class="muted small" style="margin-top:4px;">· <b>不會</b>扣到你學會的字、今日獎金或連勝——你努力學來的成果都還在。</p>
      <p class="muted small">· 每次扣多少、為什麼扣，媽媽都會寫下來，不會不清不楚。</p>
      <p class="muted small" style="margin-top:8px;">說好的事做到，就不會被扣。這不是處罰，是我們一起對自己負責的方式。🌱</p>
    </div>

    <button id="start">開始練習</button>
  `;
  root.querySelector('#back').addEventListener('click', onBack);
  root.querySelector('#start').addEventListener('click', onBack);
}
