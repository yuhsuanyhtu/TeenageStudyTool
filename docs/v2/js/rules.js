// rules.js — 把獎金規則攤開講給孩子看
// 規則來源是 reward.js 的 REWARD_CONFIG，未來改設定不用改這裡

import { REWARD_CONFIG } from './reward.js';

export function renderRules(root, onBack) {
  const cfg = REWARD_CONFIG;
  const tiers = cfg.streakTiers;

  root.innerHTML = `
    <button class="back" id="back">← 回主畫面</button>
    <h1>📋 規則</h1>
    <p class="muted">最後更新 2026-05-15　·　要改規則會先跟你講</p>

    <div class="card">
      <h3>💰 怎麼賺錢</h3>
      <p>每天背單字就有錢拿，越認真錢越多。</p>

      <p style="margin-top:14px;"><b>① 基礎獎金：每天答對 ${cfg.minCorrectForBase} 個以上 = $${cfg.base}</b></p>
      <p class="muted small">當天累積要答對 ${cfg.minCorrectForBase} 個以上才有基礎獎，避免隨便玩兩下也拿錢。</p>

      <p style="margin-top:14px;"><b>② 表現加碼：每答對 1 個 = +$${cfg.perCorrect}</b></p>
      <p class="muted small">沒有上限——但「基礎 + 加碼」一天最多 $${cfg.dailyCapPreMultiplier}。每天背太多反而吸收不了，分散學比較有效。</p>

      <p style="margin-top:14px;"><b>③ 連勝加成（最重要）</b></p>
      <table class="rules-table">
        <tr><td>連 ${tiers[0].days} 天</td><td><b>×${tiers[0].multiplier}</b></td></tr>
        <tr><td>連 ${tiers[1].days} 天</td><td><b>×${tiers[1].multiplier}</b></td></tr>
        <tr><td>連 ${tiers[2].days} 天</td><td><b>×${tiers[2].multiplier} 封頂</b></td></tr>
      </table>
      <p class="muted small" style="margin-top:8px;">當天賺到的錢乘以連勝倍率。連到 30 天就滿級。</p>
    </div>

    <div class="card">
      <h3>🛡️ 連勝中斷怎麼辦</h3>
      <p><b>每月送 3 張「保護卡」</b>。漏一天自動扣一張，連勝不會歸零。</p>
      <p class="muted small" style="margin-top:6px;">真的斷掉（保護卡用完）→ <b>只降一階，不歸零</b>。例：連 14 天斷掉 → 變回 7 天那階繼續算。讓你生病、考試週也不用怕全部白做。</p>
    </div>

    <div class="card">
      <h3>🎯 四種題型怎麼選</h3>
      <p style="margin-bottom:6px;">📖 <b>從頭複習</b> — 整課單字一張張看過，會幫你拼字母、唸發音。走完整輪 +$${cfg.reviewBase}</p>
      <p style="margin-bottom:6px;">🔗 <b>連連看</b> — 暖身用，每輪固定 +$${cfg.matchReward}（很簡單可以刷，但獎金少）</p>
      <p style="margin-bottom:6px;">🇬🇧 → 🇹🇼 <b>英翻中</b> — 看英文選中文，4 選 1，會先拼字母再唸整字</p>
      <p style="margin-bottom:6px;">🇹🇼 → 🇬🇧 <b>中翻英</b> — 要拼出英文，難度最高，但學最深</p>
      <p class="muted small" style="margin-top:8px;">建議流程：先「從頭複習」過一輪 → 連連看暖身 → 英翻中認熟 → 中翻英拼字打底。</p>
      <p class="muted small">中翻英碰到「每一個英文都對」的字（例如 every / each 都是「每一」），系統會兩個都接受，不會誤判。</p>
    </div>

    <div class="card">
      <h3>📊 紀錄怎麼看</h3>
      <p class="muted small">主畫面顯示：今日獎金、可提領、已提領、連勝天數。</p>
      <p class="muted small">媽媽那邊有 Google Sheet 看得到每次練習的詳細紀錄（時間、答對幾題、賺了多少）。</p>
    </div>

    <div class="card">
      <h3>🏦 提領零用金</h3>
      <p>媽媽按主畫面的「🏦 家長提領」進去，每次以 <b>$${cfg.payoutUnit}</b> 為單位。</p>
      <p class="muted small">提領後「可提領」會減少、「已提領」會增加。Google Sheet 也會留紀錄。</p>
    </div>

    <button id="start">開始練習</button>
  `;
  root.querySelector('#back').addEventListener('click', onBack);
  root.querySelector('#start').addEventListener('click', onBack);
}
