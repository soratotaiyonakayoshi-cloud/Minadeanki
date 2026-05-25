const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder, ChannelType } = require('discord.js');
const axios = require('axios');
const { parse } = require('csv-parse/sync');

// 🌐 設定エリア
const SPREADSHEET_CSV_URL = process.env.SPREADSHEET_CSV_URL;
const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL; // 👈 これが漏れていないかチェック！

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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quick-quiz')
    .setDescription('専用スレッドを作成し、早押しゲームモードで出題します'),
  async execute(interaction) {
    const currentQuizData = await getQuizDataFromSheets();
    if (currentQuizData.length === 0) {
      return interaction.reply({ content: '問題データベースが空っぽです。', flags: 64 });
    }

    await interaction.reply({ content: '⏳ クイズ用の専用部屋を作成しています...', flags: 64 });

    const randomIndex = Math.floor(Math.random() * currentQuizData.length);
    const quiz = currentQuizData[randomIndex];
    const startTime = Date.now();

    const thread = await interaction.channel.threads.create({
      name: `🛎️【${interaction.user.displayName}】早押し部屋`,
      autoArchiveDuration: 60,
      type: ChannelType.PublicThread,
    });

    const button = new ButtonBuilder()
      .setCustomId(`answer_${quiz.id}_${startTime}`)
      .setLabel('わかった！早押し！ 🛎️')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(button);
    const messageOptions = { content: `🎯 **${interaction.user} さんの早押しクイズが始まりました！**\n\n📝 **【問題】** [${quiz.genre}] (難易度: ${quiz.difficulty})\n${quiz.question}`, components: [row], files: [] };
    if (quiz.image) {
    // 1. 画像のURLを安全に暗号化（エンコード）する
    const encodedUrl = encodeURIComponent(quiz.image);
    // 2. GASウェブアプリのURLとドッキングさせて、変換後のURLを作る
    const proxyImageUrl = `${GAS_WEB_APP_URL}?url=${encodedUrl}`;
    
    // 3. 変換したURLを使って、メッセージに添付する
    messageOptions.files = [new AttachmentBuilder(proxyImageUrl)];
}
    
    await thread.send(messageOptions);
    await interaction.editReply({ content: `✅ 専用部屋を作成しました！こちらから参加してください ➜ ${thread}` });
  },
};
