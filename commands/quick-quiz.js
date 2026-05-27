const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const path = require('node:path');
const fs = require('node:fs');
const axios = require('axios');
const { parse } = require('csv-parse/sync');

// 🌐 設定エリア
const SPREADSHEET_CSV_URL = process.env.SPREADSHEET_CSV_URL;
const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL;

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

    // スレッド作成部分は後で try-catch に入れるために削除

    const button = new ButtonBuilder()
      .setCustomId(`answer_${quiz.id}_${startTime}`)
      .setLabel('わかった！早押し！ 🛎️')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(button);
    
    // 🌟 EmbedBuilderに変更
    const embed = new EmbedBuilder()
      .setTitle(`🎯 ${interaction.user.displayName} さんの早押しクイズ！`)
      .setDescription(`📝 **【問題】** [${quiz.genre}] (難易度: ${quiz.difficulty})\n${quiz.question}`)
      .setColor('#e11d48');

    const messageOptions = { embeds: [embed], components: [row], files: [] };
    
    if (quiz.image) {
      if (quiz.image.startsWith('http')) {
        // 🌟 GoogleドライブのURLをEmbedに直接セット（プロキシ不要）
        embed.setImage(quiz.image);
      } else {
        // 🌟 新しい形式（ローカルの images フォルダ）の画像
        const imagePath = path.join(__dirname, '..', 'images', quiz.image);
        if (fs.existsSync(imagePath)) {
          const safeImageName = 'quiz_image.png';
          messageOptions.files = [new AttachmentBuilder(imagePath, { name: safeImageName })];
          embed.setImage(`attachment://${safeImageName}`);
        } else {
          console.log(`⚠️ 画像が見つかりません: ${imagePath}`);
        }
      }
    }
    
    try {
      if (!interaction.channel.threads) {
        await interaction.channel.send(messageOptions);
        await interaction.editReply({ content: `✅ クイズパネルを作成しました！` });
      } else {
        const thread = await interaction.channel.threads.create({
          name: `🛎️【${interaction.user.displayName}】早押し部屋`,
          autoArchiveDuration: 60,
          type: ChannelType.PublicThread,
        });
        await thread.send(messageOptions);
        await interaction.editReply({ content: `✅ 専用部屋を作成しました！こちらから参加してください ➜ ${thread}` });
      }
    } catch (e) {
      console.error(e);
      await interaction.editReply({ content: '❌ エラーが発生しました。' });
    }
  },
};
