const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const path = require('node:path');
const fs = require('node:fs');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const { OpenAI } = require('openai');

// 🌐 設定エリア
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

// AIに「もっともらしい不正解」を作らせる関数
async function generateDecoys(genre, question, answer, allQuizData) {
  try {
    const prompt = `
      クイズ問題に対する「不正解の選択肢」を3つだけ考えてください。
      
      【ルール】
      ・「解説」「数字」「記号」「前置き」は一切含めず、答えの単語だけを出力すること。
      ・3つの言葉を「、」だけで区切って出力すること。
      ・「不正解A」や「ダミー」といった言葉は絶対に絶対に使わないこと。
      
      【問題】:${question}
      【正解】:${answer}
    `;

    const completion = await openai.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
    });

    const decoysText = completion.choices[0].message.content.trim();
    console.log('🤖 AI生成テキスト:', decoysText);

    let decoys = decoysText.split(/[、,\n]/)
      .map(d => d.trim().replace(/^-\s*/, '').replace(/^(不正解|ふせいかい|ダミー|選択肢)[A-Za-z0-9]?[：:]?\s*/g, ''))
      .filter(d => d.length > 0 && !d.includes('不正解'));

    if (decoys.length < 3 || decoys.some(d => d.includes('選択肢') || d.includes('候補'))) {
      const otherAnswers = allQuizData.map(q => q.answer).filter(ans => ans !== answer);
      const shuffledOthers = otherAnswers.sort(() => 0.5 - Math.random());
      decoys = shuffledOthers.slice(0, 3);
    }
    return decoys.slice(0, 3);
  } catch (error) {
    const otherAnswers = allQuizData.map(q => q.answer).filter(ans => ans !== answer);
    return otherAnswers.sort(() => 0.5 - Math.random()).slice(0, 3);
  }
}

// シャッフル関数
function shuffleArray(array) {
  let currentIndex = array.length;
  while (currentIndex !== 0) {
    let randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quiz')
    .setDescription('AIが生成した4択パネルクイズを出題します'),
  
  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const currentQuizData = await getQuizDataFromSheets();
    if (currentQuizData.length === 0) {
      return interaction.editReply({ content: '問題データベースが空っぽです。' });
    }

    const randomIndex = Math.floor(Math.random() * currentQuizData.length);
    const quiz = currentQuizData[randomIndex];

    const decoys = await generateDecoys(quiz.genre, quiz.question, quiz.answer, currentQuizData);

    const allChoices = [quiz.answer, ...decoys];
    const shuffledChoices = shuffleArray([...allChoices]);

    const correctIndex = shuffledChoices.indexOf(quiz.answer);

    const buttons = shuffledChoices.map((choice, index) => {
      return new ButtonBuilder()
        .setCustomId(`panelAnswer_${quiz.id}_${correctIndex}_${index}`) 
        .setLabel(String(choice).slice(0, 80))
        .setStyle(ButtonStyle.Secondary);
    });

    const row = new ActionRowBuilder().addComponents(buttons);
    
    // 🌟 EmbedBuilder（リッチなカード形式）に変更
    const embed = new EmbedBuilder()
      .setTitle('🎯 4択クイズ！正解のボタンを押してね！')
      .setDescription(`📝 **【問題】** [${quiz.genre}] (難易度: ${quiz.difficulty})\n${quiz.question}`)
      .setColor('#005bac');

    const messageOptions = { 
      embeds: [embed],
      components: [row],
      files: [] 
    };
    
    if (quiz.image) {
      const safeImageName = 'quiz_image.png';
      
      if (quiz.image.startsWith('http')) {
        // 古い形式（URL）の画像
        const encodedUrl = encodeURIComponent(quiz.image);
        const proxyImageUrl = `${GAS_WEB_APP_URL}?url=${encodedUrl}`;
        messageOptions.files = [new AttachmentBuilder(proxyImageUrl, { name: safeImageName })];
        embed.setImage(`attachment://${safeImageName}`);
      } else {
        // 🌟 新しい形式（ローカルの images フォルダ）の画像
        const imagePath = path.join(__dirname, '..', 'images', quiz.image);
        if (fs.existsSync(imagePath)) {
          messageOptions.files = [new AttachmentBuilder(imagePath, { name: safeImageName })];
          embed.setImage(`attachment://${safeImageName}`); // 🌟 これで画像がドカンと表示されます！
        } else {
          console.log(`⚠️ 画像が見つかりません: ${imagePath}`);
        }
      }
    }
    
    const isThread = interaction.channel.isThread();

    try {
      if (isThread) {
        await interaction.channel.send(messageOptions);
        await interaction.editReply({ content: '✅ 新しい問題を出題しました！' });
      } else {
        const thread = await interaction.channel.threads.create({
          name: `🎮 4択パネルクイズ部屋`,
          autoArchiveDuration: 60,
          type: ChannelType.PublicThread,
        });
        await thread.send(messageOptions);
        await interaction.editReply({ content: `✅ クイズパネルの準備完了！ ➜ ${thread}` });
      }
    } catch (error) {
      console.error('出題送信エラー💦', error);
      await interaction.editReply({ content: '❌ 出題処理中にエラーが発生しました。' });
    }
  },
};
