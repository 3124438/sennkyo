let masterData = null;

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
    autoInterestBuff: 0,
    // スプシから読み込む設定値
    fixedCost: 500000,       // デフォルト値（スプシにない場合のバックアップ）
    donationMultiplier: 5000 // デフォルト値
};

window.onload = async function() {
    const success = await loadMasterData();
    if (success) {
        initGame();
    } else {
        document.getElementById('trend-desc').innerHTML = `
            <span style="color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; display: block; border-radius: 4px; font-weight: bold;">
                ❌ データの読み込みに失敗しました。data/game_master_data.json を確認してください。
            </span>`;
    }
};

async function loadMasterData() {
    try {
        const response = await fetch('data/game_master_data.json');
        if (response.ok) {
            masterData = await response.json();
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

function initGame() {
    gameState.turn = 1;
    gameState.actionCount = 3;
    
    // スプシの日本語キー構造から初期値を安全に読み込み
    gameState.funds = 10000000; 
    gameState.voting_rate = 35;
    gameState.political_interest = 30;
    gameState.support_rate = 50;
    gameState.sns_influence = 20;
    gameState.school_cooperation = 10;
    gameState.autoInterestBuff = 0;

    // 【新規】設定シートから固定費と寄付金倍率を取得（日本語キーに対応）
    // JSONのsettingオブジェクト内から、対応する値を探します
    if (masterData.setting) {
        // もしスプシ側で「固定費」「寄付金倍率」という日本語行がある場合、そこから数値を引っ張るための処理
        // 安全策として、スプシにデータがまだ無くてもエラーにならないよう、数値に変換できる場合のみ上書きします
        const s = masterData.setting;
        if (s["固定費"]) gameState.fixedCost = Number(s["固定費"]) || 500000;
        if (s["寄付金倍率"]) gameState.donationMultiplier = Number(s["寄付金倍率"]) || 5000;
        
        // ※もしJSON側が "fixed_cost" や "donation_multiplier" というキーで入ってきた場合もカバー
        if (s["fixed_cost"]) gameState.fixedCost = Number(s["fixed_cost"]);
        if (s["donation_multiplier"]) gameState.donationMultiplier = Number(s["donation_multiplier"]);
    }

    logMessage("🎮 スプレッドシートのデータでゲームを開始しました！");
    startTurn();
}

function startTurn() {
    gameState.actionCount = 3;
    document.getElementById('end-turn-btn').disabled = true;

    // 【新規】スプシで指定した「値（倍率） × 支持率」で寄付金を算出！
    let income = Math.floor(gameState.support_rate * gameState.donationMultiplier);
    let fixedCost = gameState.fixedCost; // スプシから取得した固定費
    
    gameState.funds += (income - fixedCost);
    logMessage(`💰 今月の収支: 寄付金 +${income.toLocaleString()}円 / 固定費 -${fixedCost.toLocaleString()}円`);

    // トレンド決定
    const validTrends = masterData.trend_master.filter(t => t["トレンドID"] !== "trend_id");
    if (validTrends.length > 0) {
        const randomIndex = Math.floor(Math.random() * validTrends.length);
        gameState.currentTrend = validTrends[randomIndex];
        document.getElementById('trend-desc').innerHTML = `<strong>【${gameState.currentTrend["イベント名"]}】</strong> ${gameState.currentTrend["トレンド説明文"]} (バフ対象: ${gameState.currentTrend["バフ対象"]}行動が 効果 <strong>${gameState.currentTrend["バフ倍率"]}倍</strong>)`;
    }

    checkGameOver();
    createActionButtons();
    updateUI();
}

function createActionButtons() {
    const grid = document.getElementById('action-grid');
    grid.innerHTML = '';

    if (!masterData.action_master) return;

    // 行動IDが「action_id」の設定行を自動スキップ（何個増えてもここですべて綺麗に処理されます！）
    const actualActions = masterData.action_master.filter(act => act["行動ID"] !== "action_id");

    actualActions.forEach(act => {
        const name = act["行動名"] || "未定義の行動";
        const cat = act["行動カテゴリ"] || "LOCAL";
        const desc = act["説明文"] || "";
        const costVal = Number(act["消費資金"]) || 0;
        const reqSns = Number(act["必要SNS影響力"]) || 0;
        const reqSchool = Number(act["必要学校連携度"]) || 0;

        const btn = document.createElement('button');
        btn.className = 'action-btn';
        
        btn.innerHTML = `
            <strong>${name}</strong> [${cat}]<br>
            <span style="font-size:11px; color:#ddd;">${desc}</span>
            <div class="action-info">消費資金: ${costVal.toLocaleString()}円 / 必要SNS: ${reqSns} / 必要学校: ${reqSchool}</div>
        `;

        const hasActions = gameState.actionCount > 0;
        const hasMoney = gameState.funds >= costVal;
        const hasSns = gameState.sns_influence >= reqSns;
        const hasSchool = gameState.school_cooperation >= reqSchool;

        if (!hasActions || !hasMoney || !hasSns || !hasSchool) {
            btn.disabled = true;
        }

        btn.onclick = () => executeAction(act, costVal);
        grid.appendChild(btn);
    });
}

function executeAction(act, costVal) {
    if (gameState.actionCount <= 0) return;

    gameState.actionCount--;
    gameState.funds -= costVal;

    let multiplier = 1.0;
    if (gameState.currentTrend && (gameState.currentTrend["バフ対象"] === "ALL" || gameState.currentTrend["バフ対象"] === act["行動カテゴリ"])) {
        multiplier = Number(gameState.currentTrend["バフ倍率"]) || 1.0;
    }

    gameState.voting_rate += (Number(act["投票率変動幅"]) || 0) * multiplier;
    gameState.political_interest += (Number(act["関心度変動幅"]) || 0) * multiplier;
    gameState.support_rate += (Number(act["支持率変動幅"]) || 0) * multiplier;
    gameState.sns_influence += (Number(act["SNS影響力変動幅"]) || 0) * multiplier;
    gameState.school_cooperation += (Number(act["学校連携度変動幅"]) || 0) * multiplier;

    let logText = `📢 「${act["行動名"]}」を実行しました。`;
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
    if (!masterData.event_master) return;
    const validEvents = masterData.event_master.filter(ev => ev["イベントID"] !== "event_id");
    if (validEvents.length === 0) return;

    let selectedEvent = validEvents[0];
    if (gameState.support_rate >= 55) {
        gameState.funds += (Number(selectedEvent["資金影響"]) || 0);
        gameState.voting_rate += (Number(selectedEvent["投票率影響"]) || 0);
        gameState.political_interest += (Number(selectedEvent["関心度影響"]) || 0);
        gameState.support_rate += (Number(selectedEvent["支持率影響"]) || 0);

        openModal(`🎲 イベント: ${selectedEvent["イベント名"]}`, `${selectedEvent["イベントテキスト"]}`);
    }
}

function handleElection() {
    if (!masterData.election_master) return;
    const validElections = masterData.election_master.filter(e => e["選挙ID"] !== "election_id");
    if (validElections.length === 0) return;

    let election = validElections[0];
    if (gameState.voting_rate >= 40) {
        openModal(`🗳️ 定期選挙【成功】`, `<strong>${election["成功時政策名"]}</strong><br>${election["成功時説明文"]}`);
    } else {
        openModal(`🗳️ 定期選挙【失敗】`, `<strong>${election["失敗時政策名"]}</strong><br>${election["失敗時説明文"]}`);
    }
}

function checkGameOver() {
    if (gameState.funds <= 0) {
        openModal("❌ GAME OVER", "活動資金が底をつきました。", true);
        disableAllButtons();
    }
}

function checkGameClear() {
    if (gameState.voting_rate >= 70) {
        openModal("🎉 GAME CLEAR!!", "目標達成！若者の政治参加が進みました！", true);
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
