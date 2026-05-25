require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const express = require('express');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const multer = require('multer');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.commands = new Collection();
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

client.once('ready', async () => {
  console.log(`✨ 成功！ ${client.user.tag} がオンラインになりました！`);
  try {
    await client.application.commands.set(commandsData);
  } catch (error) {
    console.error('スラッシュコマンドの登録エラー💦', error);
  }
});

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
// 🌐 Webダッシュボード制御エリア
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use('/images', express.static(path.join(__dirname, 'images')));

const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, 'images/'); },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'quiz-' + uniqueSuffix + ext); 
  }
});
const upload = multer({ storage: storage });

app.get('/', async (req, res) => {
  try {
    const SPREADSHEET_CSV_URL = process.env.SPREADSHEET_CSV_URL;
    const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL;

    // 💡 1. クイズデータと「設定データ」を両方並行して取得する
    const [csvResponse, settingsResponse] = await Promise.all([
      axios.get(SPREADSHEET_CSV_URL, { headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache', 'Expires': '0' } }),
      axios.get(`${GAS_WEB_APP_URL}?action=getSettings`)
    ]);

    const allQuizData = parse(csvResponse.data, { columns: true, skip_empty_lines: true });
    const currentSettings = settingsResponse.data || { playTime: 20, questionCount: 5 };
    
    // ジャンルの自動抽出
    const uniqueGenres = Array.from(new Set(allQuizData.map(q => q.genre || '未分類')));
    let tabsHtml = `<button class="tab-btn active" onclick="filterCards('すべて', this)">すべて</button>`;
    for (const genre of uniqueGenres) {
      tabsHtml += `<button class="tab-btn" onclick="filterCards('${genre}', this)">${genre}</button>`;
    }

    const editId = req.query.edit_id || null;

    let quizCardsHtml = '';
    for (const quiz of allQuizData) {
      const quizId = quiz.id || '-';
      const currentGenre = quiz.genre || '未分類';

      if (editId && quizId.toString() === editId.toString()) {
        quizCardsHtml += `
          <div class="quiz-card editing-card" data-genre="${currentGenre}">
            <span class="id-badge"># ${quizId} を編集中</span>
            <form action="/edit-quiz" method="POST" enctype="multipart/form-data" style="margin-top: 1rem;">
              <input type="hidden" name="id" value="${quizId}">
              <input type="hidden" name="old_image" value="${quiz.image || ''}">
              
              <div class="form-row">
                <div class="form-group"> <label>🏷️ ジャンル</label> <input type="text" name="genre" class="form-control" value="${quiz.genre || ''}" required> </div>
                <div class="form-group"> <label>⭐ 難易度</label> <input type="number" name="difficulty" class="form-control" min="1" max="5" value="${quiz.difficulty || 1}" required> </div>
              </div>
              <div class="form-group"> <label>❓ 問題文</label> <textarea name="question" class="form-control" rows="3" required>${quiz.question || ''}</textarea> </div>
              <div class="form-group"> <label>✅ 正解</label> <input type="text" name="answer" class="form-control" value="${quiz.answer || ''}" required> </div>
              <div class="form-group"> <label>💡 解説（任意）</label> <textarea name="explanation" class="form-control" rows="2">${quiz.explanation || ''}</textarea> </div>
              <div class="form-group"> <label>🖼️ 画像の変更</label> <input type="file" name="image_file" class="form-control" accept="image/*"> </div>
              <div style="display:flex; gap:0.5rem; margin-top:1rem;">
                <button type="submit" class="save-btn">💾 上書き保存</button>
                <a href="/" class="cancel-btn">キャンセル</a>
              </div>
            </form>
          </div>
        `;
      } else {
        quizCardsHtml += `
          <div class="quiz-card" data-genre="${currentGenre}">
            <div class="card-header-tags">
              <input type="checkbox" class="quiz-select-checkbox" value="${quizId}" onchange="updateBulk
