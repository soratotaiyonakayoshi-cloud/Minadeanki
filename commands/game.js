const { SlashCommandBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const axios = require('axios'); // 💡 API通信用に追加

module.exports = {
  data: new SlashCommandBuilder()
    .setName('game')
    .setDescription('カスタムクイズゲームのロビーを立ち上げます'),
  async execute(interaction) {
    if (!global.activeGames) {
      global.activeGames = new Map();
    }

    // すでにそのチャンネルでゲームが動いていたらブロック
    if (global.activeGames.has(interaction.channelId)) {
      return interaction.reply({ content: '⚠️ このチャンネルではすでにゲームロビーがアクティブか、ゲームが進行中です！', flags: 64 });
    }

    // 💡 設定を読み込むため、Discordに「ちょっと待ってね」と伝える
    await interaction.deferReply();

    // ==========================================
    // ⚙️ ダッシュボード(GAS)から基本設定を取得する
    // ==========================================
    let defaultTime = 15;
    let defaultCount = 5;
    try {
      const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL;
      const res = await axios.get(`${GAS_WEB_APP_URL}?action=getSettings`);
      if (res.data) {
         defaultTime = parseInt(res.data.playTime) || 15;
         defaultCount = parseInt(res.data.questionCount) || 5;
      }
    } catch (error) {
      console.error('設定の読み込みエラー:', error);
    }

    // 🎲 取得した設定を使って初期状態のゲームデータをセット
    global.activeGames.set(interaction.channelId, {
      host: interaction.user.displayName,
      hostId: interaction.user.id,
      genre: 'all',
      timeLimit: defaultTime,
      maxQuestions: defaultCount,
      mode: 'normal',
      status: 'setup'
    });

    const modeMenu = new StringSelectMenuBuilder()
      .setCustomId('gameSetup_mode')
      .setPlaceholder('🎮 ゲームモードを選択')
      .addOptions([
        { label: '🏆 通常スコアモード（早押し高得点）', value: 'normal', default: true },
        { label: '💀 サバイバルモード（ライフ制ノックアウト）', value: 'survival' },
        { label: '🎲 ベッティングモード（100点先取・賭けクイズ）', value: 'betting' }
      ]);

    const genreMenu = new StringSelectMenuBuilder()
      .setCustomId('gameSetup_genre')
      .setPlaceholder('🎯 出題ジャンルを選んでください')
      .addOptions([
        { label: '全範囲（ランダム）', value: 'all', default: true }
      ]);

    // ⏱️ 動的メニュー生成（ダッシュボードで変な数字が設定されても対応可能！）
    const timeOptions = [
      { label: '瞬発力特化！ (5秒)', value: '5' },
      { label: '標準モード (15秒)', value: '15' },
      { label: 'じっくり思考 (30秒)', value: '30' }
    ];
    if (![5, 15, 30].includes(defaultTime)) {
      timeOptions.push({ label: `⚙️ カスタム設定 (${defaultTime}秒)`, value: String(defaultTime) });
    }
    timeOptions.forEach(opt => opt.default = (opt.value === String(defaultTime)));

    const timeMenu = new StringSelectMenuBuilder()
      .setCustomId('gameSetup_time')
      .setPlaceholder('⏱️ 1問あたりの制限時間')
      .addOptions(timeOptions);

    // 🏆 動的メニュー生成（問題数）
    const ruleOptions = [
      { label: 'サクッと3問勝負', value: '3' },
      { label: 'たっぷり5問耐久レース', value: '5' },
      { label: 'ガチ勉強会（10問）', value: '10' }
    ];
    if (![3, 5, 10].includes(defaultCount)) {
      ruleOptions.push({ label: `⚙️ カスタム設定 (${defaultCount}問)`, value: String(defaultCount) });
    }
    ruleOptions.forEach(opt => opt.default = (opt.value === String(defaultCount)));

    const ruleMenu = new StringSelectMenuBuilder()
      .setCustomId('gameSetup_rule')
      .setPlaceholder('🏆 勝利条件・問題数')
      .addOptions(ruleOptions);

    const startButton = new ButtonBuilder()
      .setCustomId('gameSetup_start')
      .setLabel('🚀 この設定でゲームスタート！')
      .setStyle(ButtonStyle.Success);

    const row0 = new ActionRowBuilder().addComponents(modeMenu);
    const row1 = new ActionRowBuilder().addComponents(genreMenu);
    const row2 = new ActionRowBuilder().addComponents(timeMenu);
    const row3 = new ActionRowBuilder().addComponents(ruleMenu);
    const row4 = new ActionRowBuilder().addComponents(startButton);

    // deferReply を使ったので、editReply で送信する
    await interaction.editReply({
      content: `⚙️ **【クイズゲームカスタムロビー】**\nお好みのルールにカスタマイズして「スタート」を押してください！\n\n🔹 **現在の設定（ダッシュボード初期値）：**\n・モード: \`🏆 通常スコア\`\n・ジャンル: \`全範囲\`\n・制限時間: \`${defaultTime}秒\`\n・勝利条件: \`${defaultCount}問終了時に最高得点\``,
      components: [row0, row1, row2, row3, row4]
    });
  },
};
