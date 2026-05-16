// reward.js — 獎金計算與連勝管理
// 設計依據：第一階段研究報告（三層混合制 + 階梯加成 + Streak Freeze）
//
// 規則：
//   - 基礎 10 元（當日答對 ≥ 5 個才有，避免無門檻）
//   - 每答對 1 個 +2 元
//   - 每日基礎+按字數的「pre-multiplier」上限 30 元
//   - 連勝倍率：7 天 ×1.2、14 天 ×1.4、30 天 ×1.6（封頂）
//   - 連勝中斷：先扣保護卡，沒卡的話只降一階不歸零
//   - 每月 3 張保護卡

export const REWARD_CONFIG = {
  base: 10,
  perCorrect: 2,
  dailyCapPreMultiplier: 100,     // 每日「基礎+按字數」封頂（連勝倍率不算在內）
  minCorrectForBase: 5,
  reviewBase: 20,                 // 從頭複習一輪固定獎金（pre-multiplier）— v2.10 起 10→20 對齊舊版直覺
  streakTiers: [
    { days: 7,  multiplier: 1.2 },
    { days: 14, multiplier: 1.4 },
    { days: 30, multiplier: 1.6 },
  ],
};

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
export function calcSessionReward({ sessionCorrect, streak, todayPreEarned, baseGivenToday }) {
  const cfg = REWARD_CONFIG;

  // 本回合 pre-multiplier 應得
  //   - 基礎獎金：今天還沒給過 + 本回合答對 ≥ 5 → 給 $10
  //   - 已經給過 → 0（避免一天多次練習重複拿基礎獎金）
  const eligibleBase = (!baseGivenToday && sessionCorrect >= cfg.minCorrectForBase) ? cfg.base : 0;
  const perWord = sessionCorrect * cfg.perCorrect;
  const sessionRawPre = eligibleBase + perWord;

  // 受日上限限制
  const remainingCap = Math.max(0, cfg.dailyCapPreMultiplier - todayPreEarned);
  const sessionPre = Math.min(sessionRawPre, remainingCap);

  const mul = streakMultiplier(streak);
  const sessionFinal = Math.round(sessionPre * mul);

  let breakdown;
  if (sessionPre === 0) {
    breakdown = sessionCorrect > 0
      ? `今天已達上限（每天 ${cfg.dailyCapPreMultiplier} 元封頂），明天再來！`
      : `本回合沒答對，沒有獎金`;
  } else {
    const baseTxt = eligibleBase > 0 ? `基礎 ${eligibleBase}` : `（未達 ${cfg.minCorrectForBase} 個正確，無基礎）`;
    const wordTxt = `答對 ${sessionCorrect} 個 +${perWord}`;
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
  };
}

// 從頭複習一輪的獎金（固定 reviewBase 元，受日上限與連勝倍率影響）
// 不依賴 sessionCorrect，只要走完一輪就拿
export function calcReviewReward({ streak, todayPreEarned }) {
  const cfg = REWARD_CONFIG;
  const remainingCap = Math.max(0, cfg.dailyCapPreMultiplier - todayPreEarned);
  const sessionPre = Math.min(cfg.reviewBase, remainingCap);
  const mul = streakMultiplier(streak);
  const sessionFinal = Math.round(sessionPre * mul);

  let breakdown;
  if (sessionPre === 0) {
    breakdown = `今天獎金已達上限（${cfg.dailyCapPreMultiplier} 元封頂）。複習仍然有用，明天再來領！`;
  } else {
    const mulTxt = mul > 1 ? `　×${mul.toFixed(1)}（連勝 ${streak} 天）` : '';
    breakdown = `從頭複習一輪 +$${sessionPre}${mulTxt} = $${sessionFinal} 元`;
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
