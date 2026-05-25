const axios = require('axios');
const { parse } = require('csv-parse/sync');
const { OpenAI } = require('openai');
const { ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder, ChannelType, StringSelectMenuBuilder } = require('discord.js');

// 🌐 設定エリア（環境変数から読み込むように変更！）
const SPREADSHEET_CSV_URL = process.env.SPREADSHEET_CSV_URL;
const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
async function getQuizDataFromSheets() {
  try {
    const response = await axios.get(SPREADSHEET_CSV_URL, {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache', 'Expires': '0' }
    });
    return parse(response.data, { columns: true, skip_empty_lines: true });
  } catch (error) {
    console.error('スプレッドシート読み込みエラー💦', error);
    return [];
  }
}

async function generateDecoys(quiz, allQuizData) {
  try {
    const prompt = `クイズの「不正解の選択肢」を3つ考えて。解説や数字、前置き(不正解：など)は一切含めず単語だけ。「、」で区切って。【問題】:${quiz.question} 【正解】:${quiz.answer}`;
    const completion = await openai.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'gpt-3.5-turbo',
      temperature: 0.5,
    });
    const decoysText = completion.choices[0].message.content.trim();
    let decoys = decoysText.split(/[、,\n]/).map(d => d.trim().replace(/^(不正解|ふせいかい|ダミー|選択肢)[A-Za-z0-9]?[：:]?\s*/g, '')).filter(d => d.length > 0 && !d.includes('不正解'));
    
    if (decoys.length < 3) {
      const others = allQuizData.map(q => q.answer).filter(ans => ans !== quiz.answer).sort(() => 0.5 - Math.random());
      decoys = others.slice(0, 3);
    }
    return decoys.slice(0, 3);
  } catch (e) {
    const others = allQuizData.map(q => q.answer).filter(ans => ans !== quiz.answer).sort(() => 0.5 - Math.random());
    return others.slice(0, 3);
  }
}

function shuffleArray(array) {
  let currentIndex = array.length;
  while (currentIndex !== 0) {
    let randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

// 出題関数（ハブ）
async function sendGameQuestion(thread, gameData) {
  gameData.roundProcessing = false; 
  if (gameData.mode === 'betting') {
    await startBettingPhase(thread, gameData);
    return;
  }

  const currentQuiz = gameData.questions[gameData.currentRound];
  const allChoices = [currentQuiz.answer, ...currentQuiz.decoys];
  const shuffledChoices = shuffleArray([...allChoices]);
  const correctIndex = shuffledChoices.indexOf(currentQuiz.answer);

  const buttons = shuffledChoices.map((choice, index) => {
    return new ButtonBuilder()
      .setCustomId(`gameAnswer_${gameData.hostId}_${correctIndex}_${index}`)
      .setLabel(String(choice).slice(0, 80))
      .setStyle(ButtonStyle.Secondary);
  });

  const row = new ActionRowBuilder().addComponents(buttons);
  gameData.roundAnswers = []; 
  gameData.roundStartTime = Date.now(); 

  let modeInfo = gameData.mode === 'survival' ? `❤️ あなたの残りライフに注意！` : `🏆 早押し高得点チャンス！`;
  
  let imageContent = '';
  if (currentQuiz.image && currentQuiz.image.startsWith('http')) {
    imageContent = `\n\n🖼️ **【画像問題】**\n${currentQuiz.image}`;
  }

  const msg = await thread.send({
    content: `━━━━━━━━━━━━━━━━━━━━━━━━\n🔥 **第 ${gameData.currentRound + 1} 問 / 全 ${gameData.maxQuestions} 問**\n⏱️ 制限時間: **${gameData.timeLimit}秒** ➜ [${gameData.mode === 'survival' ? 'サバイバルモード' : '通常スコアモード'}]\n━━━━━━━━━━━━━━━━━━━━━━━━\n${modeInfo}\n\n📝 **【問題】** [${currentQuiz.genre}]\n## ${currentQuiz.question}${imageContent}`,
    components: [row]
  });

  gameData.currentMessage = msg;
  gameData.timer = setTimeout(async () => { await endRound(thread, gameData); }, gameData.timeLimit * 1000);
}

// 🎲 ベッティングモード専用：お題のジャンル予告と賭け金受付
async function startBettingPhase(thread, gameData) {
  gameData.roundProcessing = false; 
  const currentQuiz = gameData.questions[gameData.currentRound];
  gameData.currentBets = {}; 
  gameData.roundAnswers = [];

  const buttons = [
    new ButtonBuilder().setCustomId(`gameBet_${gameData.hostId}_5`).setLabel('5点賭ける').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`gameBet_${gameData.hostId}_10`).setLabel('10点賭ける').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`gameBet_${gameData.hostId}_20`).setLabel('20点賭ける').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`gameBet_${gameData.hostId}_all`).setLabel('💰 オールイン（全額）').setStyle(ButtonStyle.Danger),
  ];
  const row = new ActionRowBuilder().addComponents(buttons);

  const msg = await thread.send({
    content: `━━━━━━━━━━━━━━━━━━━━━━━━\n🎲 **第 ${gameData.currentRound + 1} 問：ベッティングフェーズ**\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n🎯 次の問題のジャンルは **【${currentQuiz.genre}】** です！\n\n現在の持ち点から、いくら賭けるか下のボタンで選んでください！\n⏱️ 賭け受付時間: **15秒**\n*(※全員初期持ち点50点。持ち点5点未満でも救済処置で5点賭けが可能です)*`,
    components: [row]
  });

  gameData.currentMessage = msg;
  gameData.timer = setTimeout(async () => {
    await exposeBettingQuestion(thread, gameData);
  }, 15000); 
}

// 🎲 ベッティングモード専用：問題オープン！
async function exposeBettingQuestion(thread, gameData) {
  clearTimeout(gameData.timer);
  const currentQuiz = gameData.questions[gameData.currentRound];

  try { await gameData.currentMessage.delete(); } catch (e) {}

  let betStatusText = `💰 **今回のベット状況：**\n`;
  if (gameData.activePlayers.size === 0) {
    betStatusText += `（まだ参加者がいません。ボタンを押すと50点持ちで自動参加となります！）\n`;
  } else {
    for (const userId of gameData.activePlayers) {
      const pName = gameData.playerNames[userId] || '不明';
      const bet = gameData.currentBets[userId] || 0;
      betStatusText += `・**${pName}** : ${bet}点ベット (手残り: ${(gameData.scores[userId] || 50) - bet}点)\n`;
    }
  }

  const allChoices = [currentQuiz.answer, ...currentQuiz.decoys];
  const shuffledChoices = shuffleArray([...allChoices]);
  const correctIndex = shuffledChoices.indexOf(currentQuiz.answer);

  const buttons = shuffledChoices.map((choice, index) => {
    return new ButtonBuilder()
      .setCustomId(`gameAnswer_${gameData.hostId}_${correctIndex}_${index}`)
      .setLabel(String(choice).slice(0, 80))
      .setStyle(ButtonStyle.Secondary);
  });

  const row = new ActionRowBuilder().addComponents(buttons);
  gameData.roundStartTime = Date.now();

  let imageContent = '';
  if (currentQuiz.image && currentQuiz.image.startsWith('http')) {
    imageContent = `\n\n🖼️ **【画像問題】**\n${currentQuiz.image}`;
  }

  const msg = await thread.send({
    content: `━━━━━━━━━━━━━━━━━━━━━━━━\n🔥 **第 ${gameData.currentRound + 1} 問 / クイズオープン！**\n⏱️ 制限時間: **${gameData.timeLimit}秒**\n━━━━━━━━━━━━━━━━━━━━━━━━\n${betStatusText}\n\n📝 **【問題】** [${currentQuiz.genre}]\n## ${currentQuiz.question}${imageContent}`,
    components: [row]
  });

  gameData.currentMessage = msg;
  gameData.timer = setTimeout(async () => { await endRound(thread, gameData); }, gameData.timeLimit * 1000);
}

// ラウンド終了（結果発表）関数
async function endRound(thread, gameData) {
  if (gameData.roundProcessing) return;
  gameData.roundProcessing = true;

  clearTimeout(gameData.timer);
  const currentQuiz = gameData.questions[gameData.currentRound];

  try { await gameData.currentMessage.edit({ components: [] }); } catch (e) {}

  let resultText = `🎯 **【正解】** ${currentQuiz.answer}\n💡 **【解説】**\n${currentQuiz.explanation || 'なし'}\n\n`;
  
  if (gameData.mode === 'survival') {
    resultText = `🎉 **ラウンド終了！サバイバル判定**\n\n🎯 **【正解】** ${currentQuiz.answer}\n\n`;
    for (const userId of gameData.activePlayers) {
      if (gameData.lives[userId] <= 0) continue;
      const roundAns = gameData.roundAnswers.find(a => a.id === userId);
      if (!roundAns || roundAns.points === 0) {
        gameData.lives[userId]--;
        const reason = !roundAns ? '⏱️ 時間切れ' : '❌ 不正解';
        resultText += `💔 **${gameData.playerNames[userId]}** : ${reason} ➜ 残りライフ: **${gameData.lives[userId]}** ${gameData.lives[userId] <= 0 ? '💀【脱落】' : ''}\n`;
      } else {
        resultText += `💖 **${gameData.playerNames[userId]}** : 🎯 正解！ ➜ 残りライフ: **${gameData.lives[userId]}**\n`;
      }
    }
    const survivors = Object.entries(gameData.lives).filter(([id, life]) => life > 0 && gameData.activePlayers.has(id));
    if (survivors.length <= 1 && gameData.activePlayers.size > 1) {
      gameData.currentRound = gameData.maxQuestions; 
    }

  } else if (gameData.mode === 'betting') {
    resultText = `🎉 **ラウンド終了！ベッティング結果精算**\n\n🎯 **【正解】** ${currentQuiz.answer}\n\n`;
    for (const userId of gameData.activePlayers) {
      const pName = gameData.playerNames[userId] || '不明';
      const bet = gameData.currentBets[userId] || 0;
      const roundAns = gameData.roundAnswers.find(a => a.id === userId);

      if (gameData.scores[userId] === undefined) gameData.scores[userId] = 50;

      if (roundAns && roundAns.points > 0) {
        gameData.scores[userId] += bet; 
        resultText += `🎯 **${pName}** : 正解！ ➜ **+${bet}点** (現在: **${gameData.scores[userId]}点**)\n`;
      } else {
        gameData.scores[userId] -= bet; 
        const reason = !roundAns ? '⏱️ 未回答' : '❌ 不正解';
        resultText += `💸 **${pName}** : ${reason} ➜ **-${bet}点** (現在: **${gameData.scores[userId]}点**)\n`;
      }
    }

  } else {
    if (gameData.roundAnswers.length > 0) {
      resultText = `🎉 **ラウンド終了！正解リザルト**\n\n🎯 **【正解】** ${currentQuiz.answer}\n\n`;
      gameData.roundAnswers.sort((a, b) => a.time - b.time);
      gameData.roundAnswers.forEach((ans, idx) => {
        if (ans.points > 0) resultText += `${idx + 1}位: **${ans.name}** (${ans.time}秒) ➜ +${ans.points}点\n`;
      });
    } else {
      resultText += `😭 正解者は誰もいませんでした…`;
    }
  }

  await thread.send(resultText).catch(() => {});

  gameData.currentRound++;
  if (gameData.currentRound < gameData.maxQuestions) {
    await thread.send(`⏳ 5秒後に次の問題に進みます...`).catch(() => {});
    setTimeout(() => { sendGameQuestion(thread, gameData); }, 5000);
  } else {
    let finalLeaderboard = `━━━━━━━━━━━━━━━━━━━━━━━━\n🏁 **ゲーム終了！最終結果発表**\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    if (gameData.mode === 'survival') {
      const survivors = Object.entries(gameData.lives).filter(([id, life]) => life > 0 && gameData.activePlayers.has(id));
      if (survivors.length === 0) finalLeaderboard += `💀 **全滅です！** 生き残った者は誰もいませんでした…`;
      else {
        finalLeaderboard += `🏆 **見事生き残った知識王：**\n`;
        survivors.forEach(([id, life]) => { finalLeaderboard += `👑 **${gameData.playerNames[id]}** (残りライフ: ${life})\n`; });
      }
    } else if (gameData.mode === 'betting') {
      const sortedScores = Object.entries(gameData.scores).filter(([id, score]) => gameData.activePlayers.has(id)).sort((a, b) => b[1] - a[1]);
      finalLeaderboard += `🏁 規定問題数がすべて終了しました！最終資産発表：\n\n`;
      sortedScores.forEach(([id, score], idx) => { 
        const crown = score >= 100 ? '👑 ' : '';
        finalLeaderboard += `🏆 第 ${idx + 1} 位: **${gameData.playerNames[id]}** ➜ **${crown}${score} 点**\n`; 
      });
    } else {
      const sortedScores = Object.entries(gameData.scores).sort((a, b) => b[1] - a[1]);
      if (sortedScores.length === 0) finalLeaderboard += `誰もポイントを獲得できませんでした。`;
      else sortedScores.forEach((score, idx) => { finalLeaderboard += `🏆 第 ${idx + 1} 位: **${score[0]}** ➜ **${score[1]} 点**\n`; });
    }

    await thread.send(finalLeaderboard).catch(() => {});
    global.activeGames.delete(gameData.parentChannelId); 
  }
}

const formatText = (str) => { return str.normalize('NFKC').trim().toLowerCase().replace(/[\s ]/g, ''); };

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      try { await command.execute(interaction); } catch (error) { console.error(error); }
    }

    if (interaction.isButton() && interaction.customId.startsWith('answer_')) {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const parts = interaction.customId.split('_'); const quizId = parts[1]; const startTime = parseInt(parts[2], 10);
      const pushTime = Date.now(); const timeDiff = ((pushTime - startTime) / 1000).toFixed(2);
      const modal = new ModalBuilder().setCustomId(`submitAnswer_${quizId}_${timeDiff}`).setTitle('早押し解答権獲得！');
      const answerInput = new TextInputBuilder().setCustomId('playerAnswer').setLabel('答えを入力してください').setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(answerInput));
      await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('submitAnswer_')) {
      const parts = interaction.customId.split('_'); const quizId = parts[1]; const timeDiff = parts[2];
      const playerAnswer = interaction.fields.getTextInputValue('playerAnswer');
      const currentQuizData = await getQuizDataFromSheets(); const quiz = currentQuizData.find(q => q.id === quizId);
      if (quiz) {
        if (formatText(playerAnswer) === formatText(quiz.answer)) {
          await interaction.update({ content: `📝 **【問題】** [${quiz.genre}] (難易度: ${quiz.difficulty})\n${quiz.question}\n\n🎉 **正解！**\n🛎️ **${interaction.user.displayName}** さんが **${timeDiff}秒** で見事正解しました！\n\n🎯 **【答え】** ${quiz.answer}\n\n💡 **【解説】**\n${quiz.explanation}`, components: [] });
        } else {
          await interaction.reply({ content: `❌ **${interaction.user.displayName}** さん、残念！「${playerAnswer}」は不正解です！` });
        }
      }
    }

    if (interaction.isButton() && interaction.customId.startsWith('panelAnswer_')) {
      const parts = interaction.customId.split('_'); const quizId = parts[1]; const correctIndex = parts[2]; const myIndex = parts[3];
      const currentQuizData = await getQuizDataFromSheets(); const quiz = currentQuizData.find(q => q.id === quizId);
      if (quiz) {
        if (correctIndex === myIndex) {
          await interaction.update({ content: `📝 **【問題】** [${quiz.genre}] (難易度: ${quiz.difficulty})\n${quiz.question}\n\n🎉 **正解！**\n🛎️ **${interaction.user.displayName}** さんが、見事 **${quiz.answer}** を選択して正解しました！\n\n💡 **【解説】**\n${quiz.explanation}`, components: [] });
        } else {
          await interaction.reply({ content: `❌ **${interaction.user.displayName}** さん、残念！不正解です！`, flags: 64 });
        }
      }
    }

    // 🛠️ 【大改造箇所】3秒タイムアウトエラー (Unknown interaction) 対策
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('gameSetup_')) {
      const game = global.activeGames.get(interaction.channelId);
      if (!game) return interaction.reply({ content: 'ロビーの有効期限が切れています。もう一度 `/game` を実行してください。', flags: 64 });

      // ① 速攻で「受け付けました信号」を返し、3秒の制限時間を引き延ばす
      await interaction.deferUpdate().catch(() => {});

      const value = interaction.values[0];
      if (interaction.customId === 'gameSetup_genre') game.genre = value;
      if (interaction.customId === 'gameSetup_time') game.timeLimit = parseInt(value, 10);
      if (interaction.customId === 'gameSetup_rule') game.maxQuestions = parseInt(value, 10);
      if (interaction.customId === 'gameSetup_mode') game.mode = value; 

      // ② 毎回スプレッドシートをDLするのをやめ、キャッシュ(保存データ)があればそれを使う
      if (!game.cachedGenres) {
        const allQuizData = await getQuizDataFromSheets();
        game.cachedGenres = [...new Set(allQuizData.map(q => q.genre))].slice(0, 24);
      }
      const genres = game.cachedGenres;

      const modeMenu = new StringSelectMenuBuilder()
        .setCustomId('gameSetup_mode')
        .setPlaceholder('🎮 ゲームモードを選択')
        .addOptions([
          { label: '🏆 通常スコアモード（早押し高得点）', value: 'normal', default: game.mode === 'normal' },
          { label: '💀 サバイバルモード（ライフ制ノックアウト）', value: 'survival', default: game.mode === 'survival' },
          { label: '🎲 ベッティングモード（賭け金倍増・5問完走型）', value: 'betting', default: game.mode === 'betting' }
        ]);

      const genreMenu = new StringSelectMenuBuilder()
        .setCustomId('gameSetup_genre')
        .setPlaceholder('🎯 出題ジャンルを選んでください')
        .addOptions([
          { label: '全範囲（ランダム）', value: 'all', default: game.genre === 'all' },
          ...genres.map(g => ({ label: g, value: g, default: game.genre === g }))
        ]);

      const timeMenu = new StringSelectMenuBuilder()
        .setCustomId('gameSetup_time')
        .setPlaceholder('⏱️ 1問あたりの制限時間')
        .addOptions([
          { label: '瞬発力特化！ (5秒)', value: '5', default: game.timeLimit === 5 },
          { label: '標準モード (15秒)', value: '15', default: game.timeLimit === 15 },
          { label: 'じっくり思考 (30秒)', value: '30', default: game.timeLimit === 30 }
        ]);

      const ruleMenu = new StringSelectMenuBuilder()
        .setCustomId('gameSetup_rule')
        .setPlaceholder('🏆 勝利条件・問題数')
        .addOptions([
          { label: 'サクッと3問勝負', value: '3', default: game.maxQuestions === 3 },
          { label: 'たっぷり5問耐久レース', value: '5', default: game.maxQuestions === 5 },
          { label: 'ガチ勉強会（10問）', value: '10', default: game.maxQuestions === 10 }
        ]);

      const startButton = new ButtonBuilder()
        .setCustomId('gameSetup_start')
        .setLabel('🚀 この設定でゲームスタート！')
        .setStyle(ButtonStyle.Success);

      const row0 = new ActionRowBuilder().addComponents(modeMenu);
      const row1 = new ActionRowBuilder().addComponents(genreMenu);
      const row2 = new ActionRowBuilder().addComponents(timeMenu);
      const row3 = new ActionRowBuilder().addComponents(ruleMenu);
      const row4 = new ActionRowBuilder().addComponents(startButton);

      let modeLabel = '🏆 通常スコア';
      if (game.mode === 'survival') modeLabel = '💀 サバイバル（ライフ3）';
      if (game.mode === 'betting') modeLabel = '🎲 ベッティング（50点開始・問題数完走）';

      // ③ interaction.update から interaction.editReply に変更（★flags: 64 を追加して非公開を維持！）
      await interaction.editReply({
        content: `⚙️ **【クイズゲームカスタムロビー】**\nお好みのルールにカスタマイズして「スタート」を押してください！\n\n🔹 **現在の設定：**\n・モード: \`${modeLabel}\`\n・ジャンル: \`${game.genre === 'all' ? '全範囲' : game.genre}\`\n・制限時間: \`${game.timeLimit}秒\`\n・勝利条件: \`${game.maxQuestions}問終了時に最高得点\``,
        components: [row0, row1, row2, row3, row4],
        flags: 64 // 💡 ここに「自分にしか見せない」設定を復活させました！
      }).catch(() => {});
    }

    if (interaction.isButton() && interaction.customId === 'gameSetup_start') {
      const game = global.activeGames.get(interaction.channelId);
      if (!game) return interaction.reply({ content: 'エラーが発生しました。もう一度 `/game` を開き直してください。', flags: 64 });
      if (interaction.user.id !== game.hostId) return interaction.reply({ content: `❌ このゲームを開始できるのはホストだけです！`, flags: 64 });

      await interaction.update({ content: `⏳ システム発動中：AIが全 ${game.maxQuestions} 問の4択選択肢をまとめて事前生成しています…（約5〜10秒）`, components: [] });

      const allQuizData = await getQuizDataFromSheets();
      let filteredQuiz = allQuizData;
      if (game.genre !== 'all') filteredQuiz = allQuizData.filter(q => q.genre === game.genre);
      if (filteredQuiz.length === 0) return interaction.editReply({ content: '指定されたジャンルの問題が足りません！' });

      const selectedQuizzes = filteredQuiz.sort(() => 0.5 - Math.random()).slice(0, game.maxQuestions);
      game.questions = [];
      for (const quiz of selectedQuizzes) {
        const decoys = await generateDecoys(quiz, allQuizData);
        game.questions.push({ ...quiz, decoys });
      }

      game.currentRound = 0; game.scores = {}; game.lives = {}; game.playerNames = {}; game.currentBets = {};
      game.activePlayers = new Set(); game.status = 'ready'; game.parentChannelId = interaction.channelId; 

      let targetChannel = interaction.channel; let threadNotice = '';
      if (interaction.channel.threads) {
        try {
          targetChannel = await interaction.channel.threads.create({ name: `🔥【${game.host}】超早押しクイズ会場`, autoArchiveDuration: 60, type: ChannelType.PublicThread });
          threadNotice = `クイズ部屋へGO！ ➜ ${targetChannel}`;
        } catch (e) { targetChannel = interaction.channel; threadNotice = `このチャンネルでクイズを開始します！`; }
      } else { targetChannel = interaction.channel; threadNotice = `このチャンネルでクイズを開始します！`; }

      await interaction.editReply({ content: `✅ 全問題の事前生成が完了しました！${threadNotice}` });

      const realStartButton = new ButtonBuilder().setCustomId(`gameRealStart_${game.hostId}`).setLabel('🎮 ゲーム本番スタート！').setStyle(ButtonStyle.Primary);
      const startRow = new ActionRowBuilder().addComponents(realStartButton);

      let modeLabel = '🏆 通常スコア';
      if (game.mode === 'survival') modeLabel = '💀 サバイバル（ライフ3）';
      if (game.mode === 'betting') modeLabel = '🎲 ベッティング（50点開始・問題数完走）';

      await targetChannel.send({
        content: `🎮 **クイズ部屋の準備ができました！全員ここに集まってください！**\n\n🔹 **ゲーム設定：**\n・モード: \`${modeLabel}\`\n・ジャンル: \`${game.genre === 'all' ? '全範囲' : game.genre}\`\n・制限時間: \`${game.timeLimit}秒\`\n・総問題数: \`${game.maxQuestions}問\`\n\n全員の準備ができたら、ホストは下のボタンを押してゲームを開始してください！`,
        components: [startRow]
      });
    }

    if (interaction.isButton() && interaction.customId.startsWith('gameRealStart_')) {
      const hostId = interaction.customId.split('_')[1];
      let game = null; for (const g of global.activeGames.values()) { if (g.hostId === hostId && g.status === 'ready') { game = g; break; } }
      if (!game) return interaction.reply({ content: 'このゲームは無効です。', flags: 64 });
      if (interaction.user.id !== game.hostId) return interaction.reply({ content: `❌ ゲームを開始できるのはホストだけです！`, flags: 64 });

      game.status = 'playing';
      await interaction.update({ content: `🏁 **ホストがスタートボタンを押しました！ゲームを開始します！**`, components: [] });

      const countdownMsg = await interaction.channel.send(`⏳ 3...`);
      setTimeout(async () => {
        await countdownMsg.edit(`⏳ 2...`);
        setTimeout(async () => {
          await countdownMsg.edit(`⏳ 1...`);
          setTimeout(async () => { await countdownMsg.delete(); sendGameQuestion(interaction.channel, game); }, 1000);
        }, 1000);
      }, 1000);
    }

    if (interaction.isButton() && interaction.customId.startsWith('gameBet_')) {
      const parts = interaction.customId.split('_'); const hostId = parts[1]; const betType = parts[2]; 
      let activeGame = null; for (const g of global.activeGames.values()) { if (g.hostId === hostId && g.status === 'playing') { activeGame = g; break; } }
      if (!activeGame) return;

      const userName = interaction.user.displayName; const userId = interaction.user.id;
      if (activeGame.currentBets[userId] !== undefined) return interaction.reply({ content: 'すでに賭け金は決定しています！', flags: 64 });

      if (!activeGame.activePlayers.has(userId)) {
        activeGame.activePlayers.add(userId); activeGame.playerNames[userId] = userName; activeGame.scores[userId] = 50;
      }

      let myScore = activeGame.scores[userId]; let betAmount = 0;

      if (betType === 'all') betAmount = myScore;
      else betAmount = parseInt(betType, 10);

      if (betType === 'all' && myScore <= 0) betAmount = 5;
      else if (betType !== 'all' && myScore < betAmount) {
        if (myScore < 5) betAmount = 5;
        else return interaction.reply({ content: `❌ 持ち点（${myScore}点）を超えたベットはできません！オールインかそれ以下の額を選んでください。`, flags: 64 });
      }

      activeGame.currentBets[userId] = betAmount;
      await interaction.reply({ content: `🎲 **${betAmount}点** を次の【${activeGame.questions[activeGame.currentRound].genre}】に賭けました！ (現在の総資産: ${myScore}点)`, flags: 64 });

      if (activeGame.activePlayers.size > 0 && Object.keys(activeGame.currentBets).length >= activeGame.activePlayers.size) {
        await exposeBettingQuestion(interaction.channel, activeGame);
      }
    }

    if (interaction.isButton() && interaction.customId.startsWith('gameAnswer_')) {
      const parts = interaction.customId.split('_'); const hostId = parts[1]; const correctIndex = parts[2]; const myIndex = parts[3];
      let activeGame = null; for (const g of global.activeGames.values()) { if (g.hostId === hostId && g.status === 'playing') { activeGame = g; break; } }
      if (!activeGame) return;

      const userName = interaction.user.displayName; const userId = interaction.user.id;
      
      if (activeGame.mode === 'survival' && activeGame.lives[userId] <= 0 && activeGame.activePlayers.has(userId)) {
        return interaction.reply({ content: '❌ あなたはすでに脱落しています！', flags: 64 });
      }
      if (activeGame.roundAnswers.some(a => a.id === userId)) return interaction.reply({ content: 'この問題にはすでに回答しています！', flags: 64 });

      if (!activeGame.activePlayers.has(userId)) {
        activeGame.activePlayers.add(userId); activeGame.playerNames[userId] = userName;
        if (activeGame.mode === 'survival') activeGame.lives[userId] = 3;
        if (activeGame.mode === 'betting') activeGame.scores[userId] = 50; 
      }

      const clickTime = Date.now(); const timeDiff = ((clickTime - activeGame.roundStartTime) / 1000).toFixed(3);

      if (correctIndex === myIndex) {
        const rank = activeGame.roundAnswers.filter(a => a.points > 0).length;
        let points = 5; if (rank === 0) points = 10; else if (rank === 1) points = 8; else if (rank === 2) points = 6;

        if (activeGame.mode !== 'betting') activeGame.scores[userName] = (activeGame.scores[userName] || 0) + points;
        activeGame.roundAnswers.push({ id: userId, name: userName, time: timeDiff, points: 5 }); 
        await interaction.reply({ content: `🎉 **正解！**（タイム: ${timeDiff}秒）`, flags: 64 });
      } else {
        activeGame.roundAnswers.push({ id: userId, name: userName, time: 999, points: 0 }); 
        await interaction.reply({ content: `❌ **不正解！**（解答権を失いました）`, flags: 64 });
      }

      let totalTargetPlayers = activeGame.activePlayers.size;
      if (activeGame.mode === 'survival') {
        totalTargetPlayers = [...activeGame.activePlayers].filter(id => activeGame.lives[id] > 0).length;
      }

      if (activeGame.roundAnswers.length >= totalTargetPlayers && totalTargetPlayers > 0) {
        await endRound(interaction.channel, activeGame);
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('addQuizModal_')) {
      const chosenGenre = interaction.customId.replace('addQuizModal_', '');
      const newDiff = interaction.fields.getTextInputValue('diffInput'); const newQuestion = interaction.fields.getTextInputValue('questionInput');
      const newAnswer = interaction.fields.getTextInputValue('answerInput'); const newExpl = interaction.fields.getTextInputValue('explInput');
      try {
        await interaction.deferReply({ flags: 64 });
        await axios.get(GAS_WEB_APP_URL, { params: { genre: chosenGenre, difficulty: newDiff, question: newQuestion, answer: newAnswer, explanation: newExpl } });
        await interaction.editReply({ content: `🎉 **登録完了！**\n🏷️ ジャンル: ${chosenGenre}\n⭐ 難易度: ${newDiff}\n📝 問題: ${newQuestion}\n🎯 答え: ${newAnswer}` });
      } catch (error) { await interaction.editReply({ content: '❌ 保存中にエラーが発生しました。' }); }
    }

  },
};