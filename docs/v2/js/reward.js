// reward.js — 獎金計算與連勝管理
// 設計依據：第一階段研究報告（三層混合制 + 階梯加成 + Streak Freeze）
//
// 規則（v2.46 全面減半——謙恩自己要求「獎金少一半才有挑戰」，媽媽同意）：
//   - 基礎 5 元（當日答對 ≥ 5 個才有，避免無門檻）
//   - 每答對 1 個 +1 元（文意字彙／克漏字 +2）
//   - 每日基礎+按字數的「pre-multiplier」上限 50 元
//   ※ 減半的是「金額」，不是「門檻」與「連勝倍率」——做多少事拿到上限的界線跟以前一樣
//   - 連勝倍率：7 天 ×1.2、14 天 ×1.4、30 天 ×1.6（封頂）
//   - 連勝中斷：先扣保護卡，沒卡的話只降一階不歸零
//   - 每月 3 張保護卡

export const REWARD_CONFIG = {
  base: 5,                        // v2.46：10→5（全面減半）
  perCorrect: 1,                  // v2.46：2→1
  // v2.44：依題型難度分級（媽媽決定）：英翻中／中翻英 $2、文意字彙 $3、克漏字每格 $3
  // v2.46：全面減半 → 英翻中／中翻英 $1、文意字彙／克漏字 $2（難題仍是簡單題的兩倍）
  perCorrectByMode: { vocab: 2, cloze: 2 },
  dailyCapPreMultiplier: 50,      // 每日「基礎+按字數」封頂（連勝倍率不算在內）v2.46：100→50，
                                  //   跟著費率一起減半 → 「做多少題會碰到上限」維持不變
  minCorrectForBase: 5,
  reviewBase: 12,                 // v2.28：20→25；v2.46：25→12（全面減半）
  reviewDailyCap: 12,             // 從頭複習一天上限，防刷（v2.46：25→12）
  matchReward: 2,                 // 連連看一輪固定獎金 — v2.15 防 brute force（v2.46：5→2）
  readingPerCorrect: 3,           // v2.30：理解測驗答對 1 題（v2.46：$5→$3，每篇 3 題 = 最多 $9）
  // readingReward (v2.28): 已被 readingPerCorrect 取代，先留變數防舊資料報錯
  readingReward: 8,
  payoutUnit: 100,
  streakTiers: [
    { days: 7,  multiplier: 1.2 },
    { days: 14, multiplier: 1.4 },
    { days: 30, multiplier: 1.6 },
  ],
};

// v2.35：家長可在家長頁調整每日上限（v2_config_daily_cap 事件，從 Sheet 同步）。
// 各 calc 函式接受可選的 dailyCap 參數；沒給（null/undefined/0）就用預設 100。
export function effectiveDailyCap(dailyCap) {
  const v = Math.floor(Number(dailyCap));
  return (v >= 10 && v <= 1000) ? v : REWARD_CONFIG.dailyCapPreMultiplier;
}

// v2.42：練習量模式（家長頁可切，v2_config_practice 事件跨裝置同步）。
//   標準（0）＝原費率。
//   加練（1）＝「砍被動、保主動」：升國二練習量要跟上——
//     從頭複習 $12→$5（日上限同步）、連連看 $2→$1、
//     基礎獎金門檻 答對 5 題→10 題。
//   答對一題、閱讀「不動」（錢流向真測驗）；
//   v2.46：這裡的金額跟著全面減半，比例維持原設計；
//   連勝門檻也「不動」（照舊答對 5 題就保住連勝——連勝是他最在乎的，不拿來加壓）。
export function effectiveTuning(practiceMode) {
  if (Number(practiceMode) === 1) {
    return { reviewBase: 5, reviewDailyCap: 5, matchReward: 1, minCorrectForBase: 10, label: '加練模式' };
  }
  const cfg = REWARD_CONFIG;
  return { reviewBase: cfg.reviewBase, reviewDailyCap: cfg.reviewDailyCap, matchReward: cfg.matchReward, minCorrectForBase: cfg.minCorrectForBase, label: '標準' };
}

export function streakMultiplier(streak) {
  let mul = 1.0;
  for (const tier of REWARD_CONFIG.streakTiers) {
    if (streak >= tier.days) mul = tier.multiplier;
  }
  return mul;
}

// 計算這一回合可得獎金（純函式，無副作用）
// input:  { sessionCorrect, streak, todayPreEarned, baseGivenToday }
// output: { sessionPre, sessionFinal, multiplier, base, perWord, breakdown, gaveBaseThisSession }
//
// v2.13：基礎獎金一天只給一次（baseGivenToday flag），不再每 session 都給
// v2.44：各題型每題獎金
export function perCorrectFor(mode) {
  const cfg = REWARD_CONFIG;
  return (cfg.perCorrectByMode && cfg.perCorrectByMode[mode]) || cfg.perCorrect;
}

// v2.44 新增參數：
//   mode            — 題型（決定每題獎金：perCorrectFor）
//   alreadyRewarded — 克漏字同一篇今天已領過 → 這回合 $0（可以練，獎金明天再領）
//   paidCorrect     — v2.45：本回合答對的字裡，今天已經付過錢的個數（同字同題型一天一次）→ 不再計錢，但仍算「答對題數」
export function calcSessionReward({ sessionCorrect, streak, todayPreEarned, baseGivenToday, dailyCap, practiceMode, mode, alreadyRewarded, paidCorrect }) {
  const cfg = REWARD_CONFIG;
  const cap = effectiveDailyCap(dailyCap);
  const tune = effectiveTuning(practiceMode);   // v2.42：加練模式門檻 5→10
  const perCorrect = perCorrectFor(mode);

  if (alreadyRewarded) {
    return {
      sessionPre: 0, sessionFinal: 0, multiplier: 1.0, base: 0, perWord: 0,
      breakdown: `這篇今天已經領過獎金了（同一篇一天領一次）。再練一次很好，獎金明天再領！`,
      gaveBaseThisSession: false,
    };
  }

  // 本回合 pre-multiplier 應得
  //   - 基礎獎金：今天還沒給過 + 本回合答對 ≥ 門檻 → 給 $10
  //   - 已經給過 → 0（避免一天多次練習重複拿基礎獎金）
  const eligibleBase = (!baseGivenToday && sessionCorrect >= tune.minCorrectForBase) ? cfg.base : 0;
  const paidN = Math.max(0, Math.min(sessionCorrect, Number(paidCorrect) || 0));
  const payableCorrect = sessionCorrect - paidN;
  const perWord = payableCorrect * perCorrect;
  const sessionRawPre = eligibleBase + perWord;

  // 受日上限限制（v2.35：家長可調）
  const remainingCap = Math.max(0, cap - todayPreEarned);
  const sessionPre = Math.min(sessionRawPre, remainingCap);

  const mul = streakMultiplier(streak);
  const sessionFinal = Math.round(sessionPre * mul);

  let breakdown;
  if (sessionPre === 0) {
    breakdown = sessionCorrect > 0
      ? (payableCorrect === 0 && paidN > 0
          ? `答對 ${sessionCorrect} 個，但這些字今天都已經領過了（同一個字一天領一次）。換個單元或題型，錢就在那裡！`
          : `今天已達上限（每天 ${cap} 元封頂），明天再來！`)
      : `本回合沒答對，沒有獎金`;
  } else {
    const baseTxt = eligibleBase > 0 ? `基礎 ${eligibleBase}` : `（未達 ${tune.minCorrectForBase} 個正確，無基礎）`;
    const wordTxt = paidN > 0
      ? `答對 ${sessionCorrect} 個（${paidN} 個今天已領過）→ ${payableCorrect} × $${perCorrect} = +${perWord}`
      : `答對 ${sessionCorrect} 個 × $${perCorrect} = +${perWord}`;
    const capNote = sessionPre < sessionRawPre ? `（受日上限影響，採計 ${sessionPre}）` : '';
    const mulTxt = mul > 1 ? `　×${mul.toFixed(1)}（連勝 ${streak} 天）` : '';
    breakdown = `${baseTxt} ${wordTxt} = ${sessionRawPre}${capNote}${mulTxt} = ${sessionFinal} 元`;
  }

  return {
    sessionPre,
    sessionFinal,
    multiplier: mul,
    base: eligibleBase,
    perWord,
    breakdown,
    // 本回合是否實際給了基礎獎金（給了 → main.js 設定 baseGivenToday=true，下次不再給）
    gaveBaseThisSession: eligibleBase > 0 && sessionPre > 0,
    payableCorrect,      // v2.45
  };
}

// 連連看一輪的獎金（固定 matchReward 元，受日上限但不受連勝倍率影響）
// 設計：連連看可 brute force 刷對，所以不依賴 sessionCorrect，固定獎金防漏洞
// 不影響 baseGivenToday flag（base 留給其他真正考能力的模式）
// v2.45：alreadyRewarded = 這個單元今天已付過一場 → $0（可以再練）
export function calcMatchReward({ todayPreEarned, dailyCap, practiceMode, alreadyRewarded }) {
  const cfg = REWARD_CONFIG;
  const cap = effectiveDailyCap(dailyCap);
  const tune = effectiveTuning(practiceMode);   // v2.42：加練模式 $5→$2
  if (alreadyRewarded) {
    return {
      sessionPre: 0, sessionFinal: 0, multiplier: 1, base: 0, perWord: 0,
      breakdown: `這個單元的連連看今天已經領過了（同單元一天一場）。再練很好，獎金明天再領！`,
      gaveBaseThisSession: false,
    };
  }
  const remainingCap = Math.max(0, cap - todayPreEarned);
  const sessionPre = Math.min(tune.matchReward, remainingCap);
  // 不乘 streak 倍率（金額小，乘了也沒意義；保持簡單）
  const sessionFinal = sessionPre;

  let breakdown;
  if (sessionPre === 0) {
    breakdown = `今天獎金已達上限（${cap} 元封頂）。連連看仍可練習，明天再來領！`;
  } else {
    breakdown = `連連看一輪 +$${sessionPre}（連連看可刷，獎金固定 $${tune.matchReward}）`;
  }
  return {
    sessionPre,
    sessionFinal,
    multiplier: 1,
    base: 0,
    perWord: 0,
    breakdown,
    gaveBaseThisSession: false,
  };
}

// 從頭複習一輪的獎金
//   v2.28：加 reviewDailyCap（一天最多 $25），第二次以後 $0 防刷
//          仍受 dailyCapPreMultiplier 全日上限影響，仍乘 streak 倍率
export function calcReviewReward({ streak, todayPreEarned, reviewEarnedToday, dailyCap, practiceMode }) {
  const cfg = REWARD_CONFIG;
  const cap = effectiveDailyCap(dailyCap);
  const tune = effectiveTuning(practiceMode);   // v2.42：加練模式 $25→$10
  reviewEarnedToday = reviewEarnedToday || 0;
  // 兩個 cap 都要受：今日複習額度 & 全日總額度
  const reviewRemaining = Math.max(0, tune.reviewDailyCap - reviewEarnedToday);
  const globalRemaining = Math.max(0, cap - todayPreEarned);
  const sessionPre = Math.min(tune.reviewBase, reviewRemaining, globalRemaining);
  const mul = streakMultiplier(streak);
  const sessionFinal = Math.round(sessionPre * mul);

  let breakdown;
  if (sessionPre === 0) {
    if (reviewRemaining === 0) {
      breakdown = `從頭複習今天的 $${tune.reviewDailyCap} 已經拿過了，再做沒獎金（但複習本身有用）。`;
    } else {
      breakdown = `今天獎金已達總上限（${cap} 元）。明天再來領！`;
    }
  } else {
    const mulTxt = mul > 1 ? `　×${mul.toFixed(1)}（連勝 ${streak} 天）` : '';
    breakdown = `從頭複習 +$${sessionPre}${mulTxt} = $${sessionFinal} 元`;
  }
  return {
    sessionPre,
    sessionFinal,
    multiplier: mul,
    base: sessionPre,
    perWord: 0,
    breakdown,
  };
}

// v2.30：閱讀獎金 = 理解測驗答對題數 × readingPerCorrect
//   - 答對 1 題 +$5（最多 3 題 = $15/篇）
//   - 同篇一天只能領一次（重讀不再領）
//   - 答錯不扣（焦慮型設計）
//   - 受 dailyCapPreMultiplier 全日上限影響
//   - 仍乘 streak 倍率
export function calcReadingReward({ streak, todayPreEarned, storyId, readingDoneToday, comprehensionCorrect, dailyCap }) {
  const cfg = REWARD_CONFIG;
  const cap = effectiveDailyCap(dailyCap);
  readingDoneToday = readingDoneToday || [];
  comprehensionCorrect = comprehensionCorrect || 0;

  if (storyId && readingDoneToday.includes(storyId)) {
    return {
      sessionPre: 0, sessionFinal: 0,
      multiplier: 1, base: 0, perWord: 0,
      breakdown: `這篇今天已經讀過了，再讀沒獎金（但多讀幾次有助於熟悉）。`,
    };
  }
  if (comprehensionCorrect === 0) {
    return {
      sessionPre: 0, sessionFinal: 0,
      multiplier: 1, base: 0, perWord: 0,
      breakdown: `理解測驗都沒答對，這次沒獎金。下次再仔細讀！`,
    };
  }

  const rawPre = comprehensionCorrect * cfg.readingPerCorrect;
  const globalRemaining = Math.max(0, cap - todayPreEarned);
  const sessionPre = Math.min(rawPre, globalRemaining);
  const mul = streakMultiplier(streak);
  const sessionFinal = Math.round(sessionPre * mul);

  let breakdown;
  if (sessionPre === 0) {
    breakdown = `今天獎金已達總上限（${cap} 元）。閱讀仍有用，明天再讀新篇可以領！`;
  } else {
    const mulTxt = mul > 1 ? `　×${mul.toFixed(1)}（連勝 ${streak} 天）` : '';
    const capNote = sessionPre < rawPre ? `（受日上限影響，採計 ${sessionPre}）` : '';
    breakdown = `理解測驗答對 ${comprehensionCorrect} 題 × $${cfg.readingPerCorrect} = $${rawPre}${capNote}${mulTxt} = $${sessionFinal}`;
  }
  return {
    sessionPre,
    sessionFinal,
    multiplier: mul,
    base: sessionPre,
    perWord: 0,
    breakdown,
  };
}

// 連勝更新：在「當日第一次達到 minCorrectForBase」時呼叫
// today, lastDate 都是 YYYY-MM-DD
export function updateStreakOnComplete(state, today) {
  if (state.lastDate === today) return state;  // 今天已算過，不重複加

  const dayMs = 86400000;
  const yesterday = new Date(Date.parse(today) - dayMs).toISOString().slice(0, 10);

  if (state.lastDate === null || state.lastDate === yesterday) {
    // 連續或第一次
    state.streak = (state.streak || 0) + 1;
  } else {
    // 中間斷了 N 天
    const daysMissed = Math.max(
      0,
      Math.floor((Date.parse(today) - Date.parse(state.lastDate)) / dayMs) - 1
    );
    if (daysMissed > 0 && state.freezeAvailable >= daysMissed) {
      // 用保護卡補上
      state.freezeAvailable -= daysMissed;
      state.streak = (state.streak || 0) + 1;
      state._lastFreezeUsed = daysMissed;
    } else {
      // 真的斷了 → 不歸零，只降一階
      const tierThresholds = [0, 7, 14, 30];
      let curTierIdx = 0;
      for (let i = 0; i < tierThresholds.length; i++) {
        if ((state.streak || 0) >= tierThresholds[i]) curTierIdx = i;
      }
      const dropTo = curTierIdx > 0 ? tierThresholds[curTierIdx - 1] : 0;
      state.streak = Math.max(1, dropTo);
      state._lastStreakDropped = true;
    }
  }
  state.lastDate = today;
  return state;
}
