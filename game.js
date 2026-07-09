/**
 * Vote Rise 〜若者の一票が未来を変える〜
 * ゲームロジック本体（vanilla JS / no server）
 *
 * データソース: data/game_master_data.json
 * (GASの exportDataToGitHub() が生成するファイルと同じ構造)
 */

const DATA_URL = "./data/game_master_data.json";
const TOTAL_TURNS = 60;

// 「設定」シートに donation_multiplier / fixed_cost が無い場合のデフォルト値
const DEFAULT_DONATION_RATE = 5000; // support_rate × この値 が毎ターンの寄付収入
const DEFAULT_FIXED_COST = 300000;  // 毎ターンの固定費

const CLEAR_VOTING_RATE = 70;
const CLEAR_INTEREST = 70;
const GAMEOVER_SUPPORT = 20;

// event_master / condition_param の略称 → 実際のstateキー のマッピング
const CONDITION_PARAM_MAP = {
  funds: "funds",
  money: "funds",
  voting: "voting_rate",
  voting_rate: "voting_rate",
  interest: "political_interest",
  political_interest: "political_interest",
  support: "support_rate",
  support_rate: "support_rate",
  sns: "sns_influence",
  sns_influence: "sns_influence",
  school: "school_cooperation",
  school_cooperation: "school_cooperation"
};

/** ===== グローバル状態 ===== */
let master = null; // JSONそのまま
let state = null;  // ゲーム進行状態
let log = [];

/** ===== 数値・文字列パース系ユーティリティ ===== */

// "10万" "1億2000万" "1,000,000" "50000" などを数値に変換する
function parseMoneyValue(raw) {
  if (typeof raw === "number") return raw;
  if (raw === null || raw === undefined || raw === "") return 0;

  let s = String(raw).trim().replace(/,/g, "").replace(/円/g, "");
  let negative = false;
  if (s.startsWith("-")) { negative = true; s = s.slice(1); }

  let total = 0;
  let matched = false;

  const okuMatch = s.match(/(\d+(?:\.\d+)?)億/);
  if (okuMatch) {
    total += parseFloat(okuMatch[1]) * 100000000;
    s = s.replace(okuMatch[0], "");
    matched = true;
  }
  const manMatch = s.match(/(\d+(?:\.\d+)?)万/);
  if (manMatch) {
    total += parseFloat(manMatch[1]) * 10000;
    s = s.replace(manMatch[0], "");
    matched = true;
  }
  const rest = s.trim();
  if (rest !== "" && !isNaN(rest)) {
    total += parseFloat(rest);
    matched = true;
  }

  if (!matched) return 0;
  return negative ? -total : total;
}

// ">40" "<=55" "55" "＞40" などを { operator, value } に変換する
function parseThresholdExpression(raw) {
  if (typeof raw === "number") return { operator: ">=", value: raw };
  if (raw === null || raw === undefined || raw === "") return { operator: ">=", value: 0 };

  let s = String(raw).trim()
    .replace(/＞/g, ">").replace(/＜/g, "<").replace(/＝/g, "=")
    .replace(/[（(].*?[）)]/g, ""); // 括弧内の補足メモを除去

  const m = s.match(/^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return { operator: ">=", value: 0 };

  return { operator: m[1] || ">=", value: parseFloat(m[2]) };
}

function compareWithOperator(current, operator, threshold) {
  switch (operator) {
    case ">": return current > threshold;
    case ">=": return current >= threshold;
    case "<": return current < threshold;
    case "<=": return current <= threshold;
    case "=": return current === threshold;
    default: return current >= threshold;
  }
}

function numOr(v, fallback) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return typeof n === "number" && !isNaN(n) ? n : fallback;
}

// 重み付き抽選の共通処理
function weightedPick(items, weightKey = "weight", defaultWeight = 1) {
  if (items.length === 0) return null;
  const totalWeight = items.reduce((sum, it) => sum + numOr(it[weightKey], defaultWeight), 0);
  let r = Math.random() * totalWeight;
  for (const it of items) {
    r -= numOr(it[weightKey], defaultWeight);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

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
    interestAutoBonus: 0, 
    isGameOver: false,
    isCleared: false,
    gameOverReason: null,
    electionHistory: [] 
  };

  state._donationRate = numOr(s.donation_multiplier, DEFAULT_DONATION_RATE);
  state._fixedCost = numOr(s.fixed_cost, DEFAULT_FIXED_COST);

  log = [];

  addLog(`ゲーム開始。全${TOTAL_TURNS}ターン（5年間）。`);
  startTurn();
  render();
}

/** ===== マスタデータの取得 ===== */
function isFiniteNumber(v) {
  return v !== null && v !== undefined && v !== "" && !isNaN(Number(v)) && isFinite(Number(v));
}

function getValidActions() {
  return (master.action_master || []).filter(a =>
    a && typeof a.action_name === "string" && a.action_name.trim() !== "" && isFiniteNumber(a.action_id)
  );
}
function getValidTrends() {
  return (master.trend_master || []).filter(t =>
    t && typeof t.trend_name === "string" && t.trend_name.trim() !== "" && isFiniteNumber(t.trend_id)
  );
}
function getValidElections() {
  return (master.election_master || []).filter(e =>
    e && isFiniteNumber(e.election_id) && isFiniteNumber(e.election_turn)
  );
}
function getValidEvents() {
  return (master.event_master || []).filter(ev =>
    ev && typeof ev.event_name === "string" && ev.event_name.trim() !== "" && isFiniteNumber(ev.event_id)
  );
}

/** ===== ターン開始処理 ===== */
function startTurn() {
  state.turn += 1;
  state.actionsLeft = 3;

  const donation = Math.round(state.support_rate * state._donationRate);
  state.funds += donation;
  state.funds -= state._fixedCost;
  addLog(`【第${state.turn}ターン開始】寄付収入 +${donation.toLocaleString()}円 / 固定費 -${state._fixedCost.toLocaleString()}円`);

  if (state.interestAutoBonus > 0) {
    state.political_interest += state.interestAutoBonus;
    addLog(`政策効果により関心度が自動上昇 +${state.interestAutoBonus}`);
  }

  const trends = getValidTrends();
  state.currentTrend = weightedPick(trends);
  if (state.currentTrend) {
    addLog(`今月のトレンド: 「${state.currentTrend.trend_name}」(${state.currentTrend.description || ""})`);
  }

  clampStats();
  checkGameOverImmediate();
}

/** ===== 行動実行 ===== */
function canExecuteAction(action) {
  if (state.isGameOver || state.isCleared) return { ok: false, reason: "ゲームは終了しています。" };
  if (state.actionsLeft <= 0) return { ok: false, reason: "このターンの行動回数を使い切っています。" };
  if ((action.req_sns || 0) > state.sns_influence) {
    return { ok: false, reason: `SNS影響力が不足しています（必要:${action.req_sns}）` };
  }
  if ((action.req_school || 0) > state.school_cooperation) {
    return { ok: false, reason: `学校連携度が不足しています（必要:${action.req_school}）` };
  }
  const cost = parseMoneyValue(action.cost_money);
  if (cost > 0 && state.funds < cost) {
    return { ok: false, reason: "資金が不足しています。" };
  }
  return { ok: true };
}

function executeAction(actionId) {
  const action = getValidActions().find(a => String(a.action_id) === String(actionId));
  if (!action) return { ok: false, reason: "行動が見つかりません。" };

  const check = canExecuteAction(action);
  if (!check.ok) return check;

  let multiplier = 1;
  let buffed = false;
  if (state.currentTrend) {
    const target = state.currentTrend.buff_target;
    if (target === "ALL" || target === action.action_category) {
      multiplier = numOr(state.currentTrend.buff_rate, 1);
      buffed = true;
    }
  }

  const cost = parseMoneyValue(action.cost_money);
  state.funds -= cost; 
  state.voting_rate += numOr(action.effect_voting, 0) * multiplier;
  state.political_interest += numOr(action.effect_interest, 0) * multiplier;
  state.support_rate += numOr(action.effect_support, 0) * multiplier;
  state.sns_influence += numOr(action.effect_sns, 0) * multiplier;
  state.school_cooperation += numOr(action.effect_school, 0) * multiplier;

  clampStats();
  state.actionsLeft -= 1; // ここで残り行動回数が減る

  addLog(
    `行動実行: 「${action.action_name}」${buffed ? `（トレンドバフ ×${multiplier}）` : ""} ` +
    `[資金${cost >= 0 ? "-" : "+"}${Math.abs(cost).toLocaleString()}円]`
  );

  checkGameOverImmediate();
  
  // 🌟【修正ポイント】行動した瞬間に画面を最新情報に更新する処理を追加！
  render(); 
  
  return { ok: true };
}

/** ===== イベントフェーズ ===== */
function runEventPhase() {
  const events = getValidEvents().filter(ev => eventConditionMet(ev));
  if (events.length === 0) {
    addLog("特にイベントは発生しませんでした。");
    return;
  }
  const chosen = weightedPick(events);

  const moneyEff = parseMoneyValue(chosen.eff_money);
  state.funds += moneyEff;
  state.voting_rate += numOr(chosen.eff_voting, 0);
  state.political_interest += numOr(chosen.eff_interest, 0);
  state.support_rate += numOr(chosen.eff_support, 0);
  clampStats();

  addLog(`【イベント】${chosen.event_name}: ${chosen.event_text || ""}`);
  checkGameOverImmediate();
}

function eventConditionMet(ev) {
  if (!ev.condition_param) return true;

  const key = CONDITION_PARAM_MAP[String(ev.condition_param).trim()] || ev.condition_param;
  const currentValue = state[key];
  if (typeof currentValue !== "number") return true; 

  const { operator, value } = parseThresholdExpression(ev.condition_value);
  return compareWithOperator(currentValue, operator, value);
}

/** ===== 選挙フェーズ ===== */
function runElectionsForThisTurn() {
  const elections = getValidElections().filter(e => Number(e.election_turn) === state.turn);
  if (elections.length === 0) return;

  elections.forEach(election => {
    const { operator, value } = parseThresholdExpression(election.threshold_voting);
    const success = compareWithOperator(state.voting_rate, operator, value);

    if (success) {
      const bonus = numOr(election.buff_interest_auto, 0);
      state.interestAutoBonus += bonus;
      addLog(`【選挙結果】成功！「${election.policy_success_title}」 ${election.policy_success_text || ""}`);
    } else {
      const penalty = numOr(election.penalty_support, 0);
      state.support_rate -= penalty;
      addLog(`【選挙結果】失敗… 「${election.policy_fail_title}」 ${election.policy_fail_text || ""}`);
    }

    clampStats();
    state.electionHistory.push({
      turn: state.turn,
      election_id: election.election_id,
      success,
      votingRateAtCheck: state.voting_rate
    });
  });

  checkGameOverImmediate();
}

/** ===== ターン終了処理 ===== */
function endTurn() {
  if (state.isGameOver || state.isCleared) return;

  runEventPhase();
  runElectionsForThisTurn();

  if (checkGameOverImmediate()) { render(); return; }

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

/** ===== UI連携 ===== */
function getAvailableActions() {
  return getValidActions().map(a => ({
    ...a,
    _check: canExecuteAction(a),
    _costParsed: parseMoneyValue(a.cost_money)
  }));
}

function render() {
  if (typeof window !== "undefined" && typeof window.onGameStateUpdated === "function") {
    window.onGameStateUpdated(state, log, master);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    initGame, executeAction, endTurn, getAvailableActions,
    state: () => state, log: () => log,
    parseMoneyValue, parseThresholdExpression, compareWithOperator
  };
}
