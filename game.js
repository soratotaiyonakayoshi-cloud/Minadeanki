const { SlashCommandBuilder } = require('discord.js');

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

    // 🎲 初期状態のゲームデータをセット
    global.activeGames.set(interaction.channelId, {
      host: interaction.user.displayName,
      hostId: interaction.user.id,
      genre: 'all',
      timeLimit: 15,
      maxQuestions: 5,
      mode: 'normal',
      status: 'setup'
    });

    const { StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

    // 🎮 ゲームモードメニュー（ベッティングモードを追加！）
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

    const timeMenu = new StringSelectMenuBuilder()
      .setCustomId('gameSetup_time')
      .setPlaceholder('⏱️ 1問あたりの制限時間')
      .addOptions([
        { label: '瞬発力特化！ (5秒)', value: '5' },
        { label: '標準モード (15秒)', value: '15', default: true },
        { label: 'じっくり思考 (30秒)', value: '30' }
      ]);

    const ruleMenu = new StringSelectMenuBuilder()
      .setCustomId('gameSetup_rule')
      .setPlaceholder('🏆 勝利条件・問題数')
      .addOptions([
        { label: 'サクッと3問勝負', value: '3' },
        { label: 'たっぷり5問耐久レース', value: '5', default: true },
        { label: 'ガチ勉強会（10問）', value: '10' }
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

    await interaction.reply({
      content: `⚙️ **【クイズゲームカスタムロビー】**\nお好みのルールにカスタマイズして「スタート」を押してください！\n\n🔹 **現在の設定：**\n・モード: \`🏆 通常スコア\`\n・ジャンル: \`全範囲\`\n・制限時間: \`15秒\`\n・勝利条件: \`5問終了時に最高得点\``,
      components: [row0, row1, row2, row3, row4]
    });
  },
};