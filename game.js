/**
 * Vote Rise 〜若者の一票が未来を変える〜
 * ゲームロジック本体（vanilla JS / no server）
 *
 * データソース: data/game_master_data.json
 * (GASの exportDataToGitHub() が生成するファイルと同じ構造を想定)
 */

const DATA_URL = "./data/game_master_data.json";
const TOTAL_TURNS = 60;
const ELECTION_TURNS = [12, 24, 36, 48, 60];
const FIXED_COST = 300000; // 毎ターン固定費（必要に応じて調整）
const DONATION_RATE = 5000; // support_rate × この値 が毎ターンの寄付収入

const CLEAR_VOTING_RATE = 70;
const CLEAR_INTEREST = 70;
const GAMEOVER_SUPPORT = 20;

/** ===== グローバル状態 ===== */
let master = null; // JSONそのまま
let state = null;  // ゲーム進行状態
let log = [];

/** ===== 初期化 ===== */
async function initGame() {
  const res = await fetch(DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("マスタデータの読み込みに失敗しました: " + res.status);
  master = await res.json();

  const s = master.setting || {};
  state = {
    turn: 0,
    funds: numOr(s.init_funds, 10000000),
    voting_rate: numOr(s.init_voting_rate, 35),
    political_interest: numOr(s.init_political_interest, 30),
    support_rate: numOr(s.init_support_rate, 50),
    sns_influence: numOr(s.init_sns_influence, 20),
    school_cooperation: numOr(s.init_school_cooperation, 10),
    actionsLeft: 3,
    currentTrend: null,
    interestAutoBonus: 0, // 選挙成功特典の累積（毎ターン加算）
    isGameOver: false,
    isCleared: false,
    gameOverReason: null,
    electionHistory: [] // {turn, election_id, success, votingRateAtCheck}
  };
  log = [];

  addLog(`ゲーム開始。全${TOTAL_TURNS}ターン（5年間）。`);
  startTurn();
  render();
}

function numOr(v, fallback) {
  return typeof v === "number" && !isNaN(v) ? v : fallback;
}

/** ===== ターン開始処理（収入フェーズ＋トレンド発生） ===== */
function startTurn() {
  state.turn += 1;
  state.actionsLeft = 3;

  // 1. 収入・維持費フェーズ
  const donation = Math.round(state.support_rate * DONATION_RATE);
  state.funds += donation;
  state.funds -= FIXED_COST;
  addLog(`【第${state.turn}ターン開始】寄付収入 +${donation.toLocaleString()}円 / 固定費 -${FIXED_COST.toLocaleString()}円`);

  // 選挙成功特典（毎ターン関心度自動上昇）
  if (state.interestAutoBonus > 0) {
    state.political_interest += state.interestAutoBonus;
    addLog(`政策効果により関心度が自動上昇 +${state.interestAutoBonus}`);
  }

  // 2. トレンド発生フェーズ
  const trends = master.trend_master || [];
  if (trends.length > 0) {
    state.currentTrend = trends[Math.floor(Math.random() * trends.length)];
    addLog(`今月のトレンド: 「${state.currentTrend.trend_name}」(${state.currentTrend.description || ""})`);
  } else {
    state.currentTrend = null;
  }

  clampStats();
  checkGameOverImmediate(); // 資金・支持率は収入フェーズ後にも即判定
}

/** ===== 行動実行（行動選択フェーズ） ===== */
function canExecuteAction(action) {
  if (state.actionsLeft <= 0) return { ok: false, reason: "このターンの行動回数を使い切っています。" };
  if (state.isGameOver || state.isCleared) return { ok: false, reason: "ゲームは終了しています。" };
  if ((action.req_sns || 0) > state.sns_influence) {
    return { ok: false, reason: `SNS影響力が不足しています（必要:${action.req_sns}）` };
  }
  if ((action.req_school || 0) > state.school_cooperation) {
    return { ok: false, reason: `学校連携度が不足しています（必要:${action.req_school}）` };
  }
  const cost = action.cost_money || 0;
  if (cost > 0 && state.funds < cost) {
    return { ok: false, reason: "資金が不足しています。" };
  }
  return { ok: true };
}

function executeAction(actionId) {
  const action = (master.action_master || []).find(a => String(a.action_id) === String(actionId));
  if (!action) return { ok: false, reason: "行動が見つかりません。" };

  const check = canExecuteAction(action);
  if (!check.ok) return check;

  // バフ判定：トレンドのbuff_targetと行動のaction_categoryが一致すれば buff_rate 倍
  let multiplier = 1;
  let buffed = false;
  if (state.currentTrend && state.currentTrend.buff_target === action.action_category) {
    multiplier = numOr(state.currentTrend.buff_rate, 1);
    buffed = true;
  }

  state.funds -= (action.cost_money || 0); // マイナス値なら実質増加
  state.voting_rate += (action.effect_voting || 0) * multiplier;
  state.political_interest += (action.effect_interest || 0) * multiplier;
  state.support_rate += (action.effect_support || 0) * multiplier;
  state.sns_influence += (action.effect_sns || 0) * multiplier;
  state.school_cooperation += (action.effect_school || 0) * multiplier;

  clampStats();
  state.actionsLeft -= 1;

  addLog(
    `行動実行: 「${action.action_name}」${buffed ? `（トレンドバフ ×${multiplier}）` : ""} ` +
    `[資金${action.cost_money >= 0 ? "-" : "+"}${Math.abs(action.cost_money || 0).toLocaleString()}円]`
  );

  checkGameOverImmediate();
  return { ok: true };
}

/** ===== イベントフェーズ（重み付き抽選） ===== */
function runEventPhase() {
  const events = (master.event_master || []).filter(ev => eventConditionMet(ev));
  if (events.length === 0) {
    addLog("特にイベントは発生しませんでした。");
    return;
  }
  const totalWeight = events.reduce((sum, ev) => sum + numOr(ev.weight, 1), 0);
  let r = Math.random() * totalWeight;
  let chosen = events[events.length - 1];
  for (const ev of events) {
    r -= numOr(ev.weight, 1);
    if (r <= 0) { chosen = ev; break; }
  }

  state.funds += numOr(chosen.eff_money, 0);
  state.voting_rate += numOr(chosen.eff_voting, 0);
  state.political_interest += numOr(chosen.eff_interest, 0);
  state.support_rate += numOr(chosen.eff_support, 0);
  clampStats();

  addLog(`【イベント】${chosen.event_name}: ${chosen.event_text || ""}`);
  checkGameOverImmediate();
}

function eventConditionMet(ev) {
  if (!ev.condition_param) return true; // 条件なしなら常に対象
  const paramValue = state[ev.condition_param];
  if (typeof paramValue !== "number") return true;
  return paramValue >= numOr(ev.condition_value, 0);
}

/** ===== 選挙フェーズ（年末のみ） ===== */
function runElectionIfNeeded() {
  if (!ELECTION_TURNS.includes(state.turn)) return null;
  if (!state.currentTrend) {
    addLog("紐づくトレンドがないため、選挙は実施されませんでした。");
    return null;
  }
  const election = (master.election_master || [])
    .find(e => String(e.election_id) === String(state.currentTrend.connected_election_id));
  if (!election) {
    addLog("連携する選挙データが見つかりませんでした。");
    return null;
  }

  const success = state.voting_rate >= numOr(election.threshold_voting, 100);
  if (success) {
    state.interestAutoBonus += numOr(election.buff_interest_auto, 0);
    addLog(`【選挙結果】成功！「${election.policy_success_title}」 ${election.policy_success_text || ""}`);
  } else {
    state.support_rate -= numOr(election.penalty_support, 0);
    addLog(`【選挙結果】失敗… 「${election.policy_fail_title}」 ${election.policy_fail_text || ""}`);
  }

  clampStats();
  state.electionHistory.push({
    turn: state.turn,
    election_id: election.election_id,
    success,
    votingRateAtCheck: state.voting_rate
  });

  checkGameOverImmediate();
  return { election, success };
}

/** ===== ターン終了処理（判定＋次ターンへ） ===== */
function endTurn() {
  if (state.isGameOver || state.isCleared) return;

  runEventPhase();
  runElectionIfNeeded();

  // クリア/ゲームオーバー最終判定
  if (checkGameOverImmediate()) return;

  if (state.turn >= TOTAL_TURNS) {
    if (state.voting_rate >= CLEAR_VOTING_RATE && state.political_interest >= CLEAR_INTEREST) {
      state.isCleared = true;
      addLog(`🎉 クリア！投票率${state.voting_rate.toFixed(1)}% / 関心度${state.political_interest.toFixed(1)}で60ターンを終えました。`);
    } else {
      state.isGameOver = true;
      state.gameOverReason = "60ターン終了時点でクリア条件未達成";
      addLog(`ゲーム終了。クリア条件未達成（投票率${state.voting_rate.toFixed(1)}% / 関心度${state.political_interest.toFixed(1)}）`);
    }
    render();
    return;
  }

  startTurn();
  render();
}

/** ===== 判定系ユーティリティ ===== */
function checkGameOverImmediate() {
  if (state.isGameOver || state.isCleared) return true;
  if (state.funds <= 0) {
    state.isGameOver = true;
    state.gameOverReason = "資金が0円以下になりました";
    addLog("💀 ゲームオーバー：資金が尽きました。");
    return true;
  }
  if (state.support_rate < GAMEOVER_SUPPORT) {
    state.isGameOver = true;
    state.gameOverReason = "活動支持率が20未満になりました";
    addLog("💀 ゲームオーバー：支持率が低下しすぎました。");
    return true;
  }
  return false;
}

function clampStats() {
  state.voting_rate = clamp(state.voting_rate, 0, 100);
  state.political_interest = clamp(state.political_interest, 0, 100);
  state.support_rate = clamp(state.support_rate, 0, 100);
  state.sns_influence = clamp(state.sns_influence, 0, 100);
  state.school_cooperation = clamp(state.school_cooperation, 0, 100);
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function addLog(msg) {
  log.push(msg);
  if (log.length > 300) log.shift();
}

/** ===== UI連携 (index.html から呼び出される想定) ===== */
function getAvailableActions() {
  return (master.action_master || []).map(a => ({
    ...a,
    _check: canExecuteAction(a)
  }));
}

// index.html側で render() を実装して画面更新する
function render() {
  if (typeof window !== "undefined" && typeof window.onGameStateUpdated === "function") {
    window.onGameStateUpdated(state, log, master);
  }
}

// エクスポート（モジュールとしても、グローバルとしても使えるように）
if (typeof module !== "undefined" && module.exports) {
  module.exports = { initGame, executeAction, endTurn, getAvailableActions, state: () => state, log: () => log };
}
