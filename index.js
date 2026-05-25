require('dotenv').config();
const fs = require('node:fs');
const path = require('path');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// 📁 コマンドをコレクション（記憶領域）に格納する準備
client.commands = new Collection();

// 📂 commands フォルダ内のすべての .js ファイルを読み込む
const commandsPath = path.join(__dirname, 'commands'); // フォルダ名が「commands」の場合
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

// 🔑 あなたのBOT_TOKEN
// index.js の一番最後の方
client.login(process.env.DISCORD_TOKEN); // 👈 環境変数から読み込む
