require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const express = require('express'); // 🌐 Webサーバー用の部品を追加！
// 💡 この2行を追加！スプレッドシートを読み込むための部品です
const axios = require('axios');
const { parse } = require('csv-parse/sync');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// 📁 コマンドをコレクション（記憶領域）に格納する準備
client.commands = new Collection();

// 📂 commands フォルダ内のすべての .js ファイルを読み込む
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath);

const commandsData = [];

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    commandsData.push(command.data.toJSON());
  } else {
    console.log(`⚠️ 【警告】 ${filePath} のコマンドには "data" または "execute" がありません。`);
  }
}

// ⚙️ 起動時にスラッシュコマンドをDiscordに登録・更新する処理
client.once('ready', async () => {
  console.log(`✨ 成功！ ${client.user.tag} がオンラインになりました！`);
  try {
    await client.application.commands.set(commandsData);
    console.log('📱 全てのスラッシュコマンドの登録・更新が完了しました！');
  } catch (error) {
    console.error('スラッシュコマンドの登録エラー💦', error);
  }
});

// 📂 events フォルダ内のイベントファイルを読み込む
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath);

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args, client));
  } else {
    client.on(event.name, (...args) => event.execute(...args, client));
  }
}

// ==========================================
// 🌐 【新設】魔法のWebダッシュボード制御エリア
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

// 🖼️ 以前作った「images」フォルダをWebに公開する設定（画像表示用）
app.use('/images', express.static(path.join(__dirname, 'images')));

// 🏠 ダッシュボードのトップページ（クイズ一覧表示）
app.get('/', async (req, res) => {
  try {
    // ① スプレッドシートから最新のクイズデータを取得！
    const SPREADSHEET_CSV_URL = process.env.SPREADSHEET_CSV_URL;
    const response = await axios.get(SPREADSHEET_CSV_URL, {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache', 'Expires': '0' }
    });
    const allQuizData = parse(response.data, { columns: true, skip_empty_lines: true });

    // ② クイズのデータを、カッコいい「カード」のHTMLに変換する
    let quizCardsHtml = '';
    for (const quiz of allQuizData) {
      quizCardsHtml += `
        <div class="quiz-card">
          <span class="genre-badge">${quiz.genre || 'ジャンルなし'}</span>
          <h3>Q. ${quiz.question}</h3>
          <p><strong>A.</strong> <span class="answer">${quiz.answer}</span></p>
          ${quiz.explanation ? `<p class="explanation">💡 ${quiz.explanation}</p>` : ''}
          ${quiz.image ? `<p class="has-image">🖼️ 画像あり</p>` : ''}
        </div>
      `;
    }

    // ③ 組み立てたカードをWeb画面として送信！
    res.send(`
      <!DOCTYPE html>
      <html lang="ja">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>クイズBot ダッシュボード</title>
        <style>
          body {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            color: #f8fafc;
            margin: 0;
            padding: 2rem;
          }
          .header {
            text-align: center;
            margin-bottom: 3rem;
          }
          h1 {
            font-size: 2.5rem;
            background: linear-gradient(to right, #38bdf8, #818cf8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.5rem;
          }
          .header p {
            color: #94a3b8;
            font-size: 1.2rem;
          }
          .quiz-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 1.5rem;
            max-width: 1200px;
            margin: 0 auto;
          }
          .quiz-card {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 1.5rem;
            border-radius: 16px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
            transition: transform 0.2s;
          }
          .quiz-card:hover {
            transform: translateY(-5px);
            border-color: rgba(56, 189, 248, 0.5);
          }
          .genre-badge {
            display: inline-block;
            background: #3b82f6;
            color: white;
            padding: 0.3rem 0.8rem;
            border-radius: 9999px;
            font-size: 0.8rem;
            font-weight: bold;
            margin-bottom: 1rem;
          }
          .quiz-card h3 {
            margin: 0 0 1rem 0;
            font-size: 1.1rem;
            color: #e2e8f0;
            line-height: 1.4;
          }
          .answer {
            color: #4ade80;
            font-weight: bold;
            font-size: 1.1rem;
          }
          .explanation {
            font-size: 0.9rem;
            color: #94a3b8;
            margin-top: 1rem;
            padding-top: 1rem;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            line-height: 1.5;
          }
          .has-image {
            font-size: 0.8rem;
            color: #fcd34d;
            margin-top: 0.5rem;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🔮 QUIZ BOT DASHBOARD</h1>
          <p>現在登録されているクイズ一覧（全 ${allQuizData.length} 問）</p>
        </div>
        <div class="quiz-grid">
          ${quizCardsHtml}
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('ダッシュボードでのクイズ読み込みエラー:', error);
    res.send('<h2 style="color:white; text-align:center;">エラーが発生しました。スプレッドシートの読み込みに失敗しました。</h2>');
  }
});

// ⚡ サーバーの起動
app.listen(PORT, () => {
  console.log(`🌐 Webサーバーがポート ${PORT} で起動しました！`);
});

// 🔑 あなたのBOT_TOKENでDiscord Botをログイン
client.login(process.env.BOT_TOKEN);
