// スプレッドシートのデータを受け取るための空の箱（仮データは削除）
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
        // スプシのデータが正常に読めたらゲーム開始
        initGame();
    } else {
        // 読めなかったら画面に分かりやすく大バナーでエラーを出す（検証用）
        document.getElementById('trend-desc').innerHTML = `
            <span style="color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; display: block; border-radius: 4px; font-weight: bold;">
                ❌ スプレッドシートのデータ同期に失敗しています！<br>
                GitHubの「data」フォルダの中に「game_master_data.json」が正しく作られているか、またはGASのボタンを押して同期したか確認してください。
            </span>`;
        logMessage("❌ エラー：JSONデータが読み込めないため、ゲームの初期化をシールドしました。");
    }
};

// JSONファイルを読み込む関数
async function loadMasterData() {
    try {
        // GitHub上のJSONファイルを読みに行く
        const response = await fetch('data/game_master_data.json');
        if (response.ok) {
            const fetchedData = await response.json();
            
            // 最低限必要なデータ（設定と行動）が入っているかチェック
            if (fetchedData && fetchedData.setting && fetchedData.action_master) {
                masterData = fetchedData;
                logMessage("📊 スプレッドシート由来のJSONデータを【正常に適用】しました！");
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
    gameState.funds = Number(masterData.setting.init_funds) || 10000000;
    gameState.voting_rate = Number(masterData.setting.init_voting_rate) || 35;
    gameState.political_interest = Number(masterData.setting.init_political_interest) || 30;
    gameState.support_rate = Number(masterData.setting.init_support_rate) || 50;
    gameState.sns_influence = Number(masterData.setting.init_sns_influence) || 20;
    gameState.school_cooperation = Number(masterData.setting.init_school_cooperation) || 10;
    gameState.autoInterestBuff = 0;

    logMessage("🎮 本番データで活動開始！5年間（60ヶ月）で若者の投票率を70%以上に引き上げましょう！");
    startTurn();
}

// ターン（月）の開始
function startTurn() {
    gameState.actionCount = 3;
    document.getElementById('end-turn-btn').disabled = true;

    // 寄付収入（支持率×5000円）と運営維持固定費（50万円）の計算
    let income = Math.floor(gameState.support_rate * 5000);
    let fixedCost = 500000;
    gameState.funds += (income - fixedCost);
    logMessage(`💰 今月の収支: 寄付金 +${income.toLocaleString()}円 / 固定費 -${fixedCost.toLocaleString()}円`);

    // 選挙ボーナスの自動加算
    if (gameState.autoInterestBuff > 0) {
        gameState.political_interest += gameState.autoInterestBuff;
        logMessage(`✨ 選挙成功特典バフにより、政治関心度が自動で +${gameState.autoInterestBuff} 上昇！`);
    }

    // トレンドをランダムで1つ決定
    if (masterData.trend_master && masterData.trend_master.length > 0) {
        const randomIndex = Math.floor(Math.random() * masterData.trend_master.length);
        gameState.currentTrend = masterData.trend_master[randomIndex];
        document.getElementById('trend-desc').innerHTML = `<strong>【${gameState.currentTrend.trend_name}】</strong> ${gameState.currentTrend.description} (バフ対象: ${gameState.currentTrend.buff_target}行動が 効果 <strong>${gameState.currentTrend.buff_rate}倍</strong>)`;
        logMessage(`🔥 トレンド流行：現在は「${gameState.currentTrend.trend_name}」が話題です。`);
    } else {
        document.getElementById('trend-desc').innerText = "特になし（トレンドマスターが空です）";
    }

    // ゲームオーバー即時判定
    checkGameOver();

    // コマンドボタン再生成 & UI更新
    createActionButtons();
    updateUI();
}

// 行動ボタンを画面に生成
function createActionButtons() {
    const grid = document.getElementById('action-grid');
    grid.innerHTML = '';

    if (!masterData.action_master) return;

    masterData.action_master.forEach(act => {
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        
        // 費用（「10万」などの日本語表記が含まれる場合の対策処理）
        let costVal = parseInt(act.cost_money);
        if (isNaN(costVal)) costVal = 0;
        if (typeof act.cost_money === 'string' && act.cost_money.includes('万')) {
            costVal = parseInt(act.cost_money) * 10000;
        }

        btn.innerHTML = `
            <strong>${act.action_name}</strong> [${act.action_category}]<br>
            <span style="font-size:11px; color:#ddd;">${act.description}</span>
            <div class="action-info">消費資金: ${costVal.toLocaleString()}円 / 必要SNS: ${act.req_sns} / 必要学校: ${act.req_school}</div>
        `;

        // 実行制限の判定
        const hasActions = gameState.actionCount > 0;
        const hasMoney = gameState.funds >= costVal;
        const hasSns = gameState.sns_influence >= (Number(act.req_sns) || 0);
        const hasSchool = gameState.school_cooperation >= (Number(act.req_school) || 0);

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
    gameState.funds -= costVal;

    // トレンドによるバフ倍率計算
    let multiplier = 1.0;
    if (gameState.currentTrend) {
        if (gameState.currentTrend.buff_target === "ALL" || gameState.currentTrend.buff_target === act.action_category) {
            multiplier = Number(gameState.currentTrend.buff_rate) || 1.0;
        }
    }

    // 各パラメータに効果を適用
    gameState.voting_rate += (Number(act.effect_voting) || 0) * multiplier;
    gameState.political_interest += (Number(act.effect_interest) || 0) * multiplier;
    gameState.support_rate += (Number(act.effect_support) || 0) * multiplier;
    gameState.sns_influence += (Number(act.effect_sns) || 0) * multiplier;
    gameState.school_cooperation += (Number(act.effect_school) || 0) * multiplier;

    let logText = `📢 コマンド「${act.action_name}」を実行しました。`;
    if (multiplier > 1.0) logText += `（トレンド合致！効果${multiplier}倍🔥）`;
    logMessage(logText);

    createActionButtons();
    updateUI();

    if (gameState.actionCount === 0) {
        document.getElementById('end-turn-btn').disabled = false;
    }
}

// ターン終了（次の月へ移動）
function endTurn() {
    // 1. ランダムイベントの抽選と発生
    handleRandomEvent();

    // 2. 年末（12, 24, 36, 48, 60ターン）の選挙発生
    if (gameState.turn % 12 === 0) {
        handleElection();
    }

    // 3. 最終ターン（60ヶ月）終了時のクリア判定
    if (gameState.turn >= 60) {
        checkGameClear();
        return;
    }

    gameState.turn++;
    startTurn();
}

// ランダムイベントの処理
function handleRandomEvent() {
    if (!masterData.event_master || masterData.event_master.length === 0) return;

    // 発生条件を満たしているイベントを抽出
    let validEvents = masterData.event_master.filter(ev => {
        let param = ev.condition_param;
        let val = parseInt(String(ev.condition_value).replace(/[^0-9]/g, '')) || 0;
        
        if (param === "support_rate" && gameState.support_rate < val) return false;
        if (param === "sns_influence" && gameState.sns_influence < val) return false;
        return true;
    });

    if (validEvents.length === 0) return;

    // 重み（weight）による確率抽選
    let totalWeight = validEvents.reduce((sum, ev) => sum + (Number(ev.weight) || 10), 0);
    let randomNum = Math.random() * totalWeight;
    let currentSum = 0;
    let selectedEvent = validEvents[0];

    for (let ev of validEvents) {
        currentSum += (Number(ev.weight) || 10);
        if (randomNum <= currentSum) {
            selectedEvent = ev;
            break;
        }
    }

    // パラメータへの影響反映
    gameState.funds += (Number(selectedEvent.eff_money) || 0);
    gameState.voting_rate += (Number(selectedEvent.eff_voting) || 0);
    gameState.political_interest += (Number(selectedEvent.eff_interest) || 0);
    gameState.support_rate += (Number(selectedEvent.eff_support) || 0);

    openModal(`🎲 イベント発生: ${selectedEvent.event_name}`, 
              `${selectedEvent.event_text}<br><br><strong>【影響】</strong> 資金: ${(Number(selectedEvent.eff_money)||0).toLocaleString()}円 / 投票率: +${selectedEvent.eff_voting}% / 支持率: +${selectedEvent.eff_support}`);
    logMessage(`🎲 ハプニング:「${selectedEvent.event_name}」が発生しました。`);
}

// 選挙の判定処理
function handleElection() {
    if (!gameState.currentTrend || !masterData.election_master || masterData.election_master.length === 0) return;

    // 現在のトレンドと紐づいている選挙データを呼び出し
    let electionId = gameState.currentTrend.connected_election_id;
    let election = masterData.election_master.find(e => String(e.election_id) === String(electionId));
    
    if (!election) election = masterData.election_master[0]; 
    if (!election) return;

    let threshold = parseInt(String(election.threshold_voting).replace(/[^0-9]/g, '')) || 40;

    if (gameState.voting_rate >= threshold) {
        gameState.autoInterestBuff += (Number(election.buff_interest_auto) || 0);
        openModal(`🗳️ ${gameState.turn / 12}年目 定期選挙【成功】`, `横断目標クリア（投票率 ${gameState.voting_rate.toFixed(1)}% / 必要 ${threshold}%）<br><br><strong>${election.policy_success_title}</strong><br>${election.policy_success_text}`);
        logMessage(`🗳️ 選挙大成功！：${election.policy_success_title}`);
    } else {
        gameState.support_rate -= (Number(election.penalty_support) || 0);
        openModal(`🗳️ ${gameState.turn / 12}年目 定期選挙【失敗】`, `目標未達成（投票率 ${gameState.voting_rate.toFixed(1)}% / 必要 ${threshold}%）<br><br><strong>${election.policy_fail_title}</strong><br>${election.policy_fail_text}`);
        logMessage(`🗳️ 選挙失敗...：若者の声が届かず支持率が減少。`);
    }
}

// 途中のゲームオーバーチェック
function checkGameOver() {
    if (gameState.funds <= 0) {
        openModal("❌ 団体破産 (GAME OVER)", "活動資金が0円以下になり、団体の維持ができなくなりました。", true);
        disableAllButtons();
    } else if (gameState.support_rate < 20) {
        openModal("❌ 支持失墜 (GAME OVER)", "活動支持率が20未満になり、社会的な信頼を失いました。", true);
        disableAllButtons();
    }
}

// 60ターン目のゲームクリアチェック
function checkGameClear() {
    if (gameState.voting_rate >= 70 && gameState.political_interest >= 70) {
        openModal("🎉 目標達成！ゲームクリア！！", `5年間の活動お疲れ様でした！若者投票率（${gameState.voting_rate.toFixed(1)}%）と政治関心度（${gameState.political_interest.toFixed(1)}）が共に70を突破！若者の声が国を動かす新時代が到来しました！`, true);
    } else {
        openModal("⏳ 5年間の任期終了 (タイムアップ)", `60ヶ月が経過しました。惜しくも目標の「両ステータス70以上」には届きませんでしたが、社会に一石を投じることに成功しました。`, true);
    }
    disableAllButtons();
}

// UI上の表記を更新
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

// ログ欄にテキストを追記
function logMessage(msg) {
    const logBox = document.getElementById('log-box');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerText = `[Turn ${gameState.turn}] ${msg}`;
    logBox.appendChild(entry);
    logBox.scrollTop = logBox.scrollHeight;
}

// ゲーム終了時に全ボタンをロック
function disableAllButtons() {
    const buttons = document.querySelectorAll('button:not(.modal-btn)');
    buttons.forEach(b => b.disabled = true);
}

// モーダル表示の制御
function openModal(title, body) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('game-modal').style.display = 'flex';
}
function closeModal() {
    document.getElementById('game-modal').style.display = 'none';
}
