// スプレッドシートのデータを受け取るための空の箱
let masterData = null;

// ゲームの動的ステータス管理
let gameState = {
    turn: 1,
    actionCount: 3,
    funds: 0,
    voting_rate: 0,
    political_interest: 0,
    support_rate: 0,
    sns_influence: 0,
    school_cooperation: 0,
    currentTrend: null,
    autoInterestBuff: 0
};

// 起動時にデータを読み込む
window.onload = async function() {
    const success = await loadMasterData();
    if (success) {
        initGame();
    } else {
        document.getElementById('trend-desc').innerHTML = `
            <span style="color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; display: block; border-radius: 4px; font-weight: bold;">
                ❌ データの読み込みに失敗しました。data/game_master_data.json が存在するか確認してください。
            </span>`;
    }
};

// JSONファイルを正確に読み込む関数
async function loadMasterData() {
    try {
        const response = await fetch('data/game_master_data.json');
        if (response.ok) {
            masterData = await response.json();
            // データが正しくパースできているかチェック
            if (masterData && masterData.setting && masterData.action_master) {
                return true;
            }
        }
        return false;
    } catch (e) {
        console.error(e);
        return false;
    }
}

// ゲームの初期化
function initGame() {
    gameState.turn = 1;
    gameState.actionCount = 3;
    
    // JSONの構造に合わせて正確に数値をセット
    gameState.funds = Number(masterData.setting.init_funds);
    gameState.voting_rate = Number(masterData.setting.init_voting_rate);
    gameState.political_interest = Number(masterData.setting.init_political_interest);
    gameState.support_rate = Number(masterData.setting.init_support_rate);
    gameState.sns_influence = Number(masterData.setting.init_sns_influence);
    gameState.school_cooperation = Number(masterData.setting.init_school_cooperation);
    gameState.autoInterestBuff = 0;

    logMessage("🎮 本番データで活動開始！若者の声を届けましょう！");
    startTurn();
}

// ターン（月）の開始
function startTurn() {
    gameState.actionCount = 3;
    document.getElementById('end-turn-btn').disabled = true;

    // 収支計算
    let income = Math.floor(gameState.support_rate * 5000);
    let fixedCost = 500000;
    gameState.funds += (income - fixedCost);
    logMessage(`💰 今月の収支: 寄付金 +${income.toLocaleString()}円 / 固定費 -${fixedCost.toLocaleString()}円`);

    // バフ加算
    if (gameState.autoInterestBuff > 0) {
        gameState.political_interest += gameState.autoInterestBuff;
    }

    // トレンド決定
    if (masterData.trend_master && masterData.trend_master.length > 0) {
        const randomIndex = Math.floor(Math.random() * masterData.trend_master.length);
        gameState.currentTrend = masterData.trend_master[randomIndex];
        document.getElementById('trend-desc').innerHTML = `<strong>【${gameState.currentTrend.trend_name}】</strong> ${gameState.currentTrend.description} (バフ対象: ${gameState.currentTrend.buff_target}行動が 効果 <strong>${gameState.currentTrend.buff_rate}倍</strong>)`;
    }

    checkGameOver();
    createActionButtons();
    updateUI();
}

// 行動ボタンを画面に生成
function createActionButtons() {
    const grid = document.getElementById('action-grid');
    grid.innerHTML = '';

    if (!masterData.action_master) return;

    masterData.action_master.forEach(act => {
        // undefined対策としてデフォルト値を設定
        const name = act.action_name || "名無しの行動";
        const cat = act.action_category || "LOCAL";
        const desc = act.description || "";
        const costVal = Number(act.cost_money) || 0;
        const reqSns = Number(act.req_sns) || 0;
        const reqSchool = Number(act.req_school) || 0;

        const btn = document.createElement('button');
        btn.className = 'action-btn';
        
        btn.innerHTML = `
            <strong>${name}</strong> [${cat}]<br>
            <span style="font-size:11px; color:#ddd;">${desc}</span>
            <div class="action-info">消費資金: ${costVal.toLocaleString()}円 / 必要SNS: ${reqSns} / 必要学校: ${reqSchool}</div>
        `;

        // 条件判定
        const hasActions = gameState.actionCount > 0;
        const hasMoney = costVal < 0 ? true : (gameState.funds >= costVal); // 資金獲得（マイナス）の場合は常にパス
        const hasSns = gameState.sns_influence >= reqSns;
        const hasSchool = gameState.school_cooperation >= reqSchool;

        if (!hasActions || !hasMoney || !hasSns || !hasSchool) {
            btn.disabled = true;
        }

        btn.onclick = () => executeAction(act, costVal);
        grid.appendChild(btn);
    });
}

// 行動の実行処理
function executeAction(act, costVal) {
    if (gameState.actionCount <= 0) return;

    gameState.actionCount--;
    
    // 資金の増減（マイナス値なら資金が増える）
    gameState.funds -= costVal;

    let multiplier = 1.0;
    if (gameState.currentTrend && (gameState.currentTrend.buff_target === "ALL" || gameState.currentTrend.buff_target === act.action_category)) {
        multiplier = Number(gameState.currentTrend.buff_rate) || 1.0;
    }

    gameState.voting_rate += (Number(act.effect_voting) || 0) * multiplier;
    gameState.political_interest += (Number(act.effect_interest) || 0) * multiplier;
    gameState.support_rate += (Number(act.effect_support) || 0) * multiplier;
    gameState.sns_influence += (Number(act.effect_sns) || 0) * multiplier;
    gameState.school_cooperation += (Number(act.effect_school) || 0) * multiplier;

    let logText = `📢 「${act.action_name}」を実行しました。`;
    if (multiplier > 1.0) logText += `（トレンド効果 ${multiplier}倍🔥）`;
    logMessage(logText);

    createActionButtons();
    updateUI();

    if (gameState.actionCount === 0) {
        document.getElementById('end-turn-btn').disabled = false;
    }
}

function endTurn() {
    handleRandomEvent();
    if (gameState.turn % 12 === 0) {
        handleElection();
    }
    if (gameState.turn >= 60) {
        checkGameClear();
        return;
    }
    gameState.turn++;
    startTurn();
}

function handleRandomEvent() {
    if (!masterData.event_master || masterData.event_master.length === 0) return;

    let validEvents = masterData.event_master.filter(ev => {
        if (!ev.condition_param) return true; // 条件なし
        let val = Number(ev.condition_value) || 0;
        if (ev.condition_param === "sns_influence" && gameState.sns_influence < val) return false;
        if (ev.condition_param === "school_cooperation" && gameState.school_cooperation < val) return false;
        return true;
    });

    if (validEvents.length === 0) return;

    let totalWeight = validEvents.reduce((sum, ev) => sum + (Number(ev.weight) || 1), 0);
    let randomNum = Math.random() * totalWeight;
    let currentSum = 0;
    let selectedEvent = validEvents[0];

    for (let ev of validEvents) {
        currentSum += (Number(ev.weight) || 1);
        if (randomNum <= currentSum) {
            selectedEvent = ev;
            break;
        }
    }

    gameState.funds += (Number(selectedEvent.eff_money) || 0);
    gameState.voting_rate += (Number(selectedEvent.eff_voting) || 0);
    gameState.political_interest += (Number(selectedEvent.eff_interest) || 0);
    gameState.support_rate += (Number(selectedEvent.eff_support) || 0);

    if (selectedEvent.event_name !== "特に何もない月") {
        openModal(`🎲 イベント: ${selectedEvent.event_name}`, `${selectedEvent.event_text}`);
    }
}

function handleElection() {
    if (!masterData.election_master || masterData.election_master.length === 0) return;
    let election = masterData.election_master[0];
    let threshold = Number(election.threshold_voting) || 45;

    if (gameState.voting_rate >= threshold) {
        gameState.autoInterestBuff += (Number(election.buff_interest_auto) || 0);
        openModal(`🗳️ 定期選挙【成功】`, `目標達成！（投票率 ${gameState.voting_rate.toFixed(1)}%）<br><br><strong>${election.policy_success_title}</strong><br>${election.policy_success_text}`);
    } else {
        gameState.support_rate -= (Number(election.penalty_support) || 0);
        openModal(`🗳️ 定期選挙【失敗】`, `目標未達成…（投票率 ${gameState.voting_rate.toFixed(1)}%）<br><br><strong>${election.policy_fail_title}</strong><br>${election.policy_fail_text}`);
    }
}

function checkGameOver() {
    if (gameState.funds <= 0) {
        openModal("❌ GAME OVER", "活動資金が底をつきました。", true);
        disableAllButtons();
    } else if (gameState.support_rate < 20) {
        openModal("❌ GAME OVER", "支持率が低下し、活動継続が困難になりました。", true);
        disableAllButtons();
    }
}

function checkGameClear() {
    if (gameState.voting_rate >= 70) {
        openModal("🎉 GAME CLEAR!!", "若者の投票率を大幅に引き上げることに成功しました！", true);
    } else {
        openModal("⏳ 任期終了", "5年間の活動が終了しました。", true);
    }
    disableAllButtons();
}

function updateUI() {
    const year = Math.floor((gameState.turn - 1) / 12) + 1;
    const month = ((gameState.turn - 1) % 12) + 1;

    document.getElementById('stat-turn').innerText = `${gameState.turn} / 60 ヶ月 (${year}年目 ${month}ヶ月)`;
    document.getElementById('stat-actions').innerText = `${gameState.actionCount} 回`;
    document.getElementById('stat-funds').innerText = `${gameState.funds.toLocaleString()}円`;
    document.getElementById('stat-voting').innerText = `${gameState.voting_rate.toFixed(1)}%`;
    document.getElementById('stat-interest').innerText = gameState.political_interest.toFixed(1);
    document.getElementById('stat-support').innerText = gameState.support_rate.toFixed(1);
    document.getElementById('stat-sns').innerText = gameState.sns_influence.toFixed(1);
    document.getElementById('stat-school').innerText = gameState.school_cooperation.toFixed(1);
    document.getElementById('action-count-text').innerText = gameState.actionCount;
}

function logMessage(msg) {
    const logBox = document.getElementById('log-box');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerText = `[${gameState.turn}ヶ月目] ${msg}`;
    logBox.appendChild(entry);
    logBox.scrollTop = logBox.scrollHeight;
}

function disableAllButtons() {
    document.querySelectorAll('button:not(.modal-btn)').forEach(b => b.disabled = true);
}

function openModal(title, body) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('game-modal').style.display = 'flex';
}
function closeModal() {
    document.getElementById('game-modal').style.display = 'none';
}
