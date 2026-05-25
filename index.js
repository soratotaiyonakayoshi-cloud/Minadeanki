require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const express = require('express'); // 🌐 Webサーバー用の部品を追加！

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

// 🏠 ダッシュボードのトップページ（土台）のHTMLデザイン
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>クイズBot 魔法のダッシュボード</title>
      <style>
        body {
          font-family: 'Helvetica Neue', Arial, sans-serif;
          background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
          color: #f8fafc;
          margin: 0;
          padding: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
        }
        .container {
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 3rem;
          border-radius: 24px;
          text-align: center;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
          max-width: 500px;
          width: 90%;
        }
        h1 {
          font-size: 2.5rem;
          margin-bottom: 0.5rem;
          background: linear-gradient(to right, #38bdf8, #818cf8);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        p {
          color: #94a3b8;
          font-size: 1.1rem;
          line-height: 1.6;
        }
        .status-badge {
          display: inline-block;
          background: rgba(34, 197, 94, 0.2);
          border: 1px solid #22c55e;
          color: #4ade80;
          padding: 0.5rem 1.5rem;
          border-radius: 9999px;
          font-weight: bold;
          margin-top: 1.5rem;
          font-size: 0.9rem;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔮 QUIZ BOT DASHBOARD</h1>
        <p>おめでとうございます！<br>世界に一つだけの魔法のダッシュボードの土台が、無事に開通しました！</p>
        <div class="status-badge">🟢 SERVER ONLINE (PORT: ${PORT})</div>
      </div>
    </body>
    </html>
  `);
});

// ⚡ サーバーの起動
app.listen(PORT, () => {
  console.log(`🌐 Webサーバーがポート ${PORT} で起動しました！`);
});

// 🔑 あなたのBOT_TOKENでDiscord Botをログイン
client.login(process.env.BOT_TOKEN);
