require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const express = require('express');
const axios = require('axios');
const { parse } = require('csv-parse/sync');

// ==========================================================
// 🗄️ 最近の画像履歴を管理
// ==========================================================
const RECENT_IMAGES_PATH = path.join(__dirname, 'data', 'recent_images.json');
function addRecentImage(url) {
  try {
    if (!fs.existsSync(RECENT_IMAGES_PATH)) fs.writeFileSync(RECENT_IMAGES_PATH, '[]');
    const images = JSON.parse(fs.readFileSync(RECENT_IMAGES_PATH, 'utf8'));
    images.unshift({ url, timestamp: new Date().toISOString() });
    if (images.length > 50) images.length = 50; // 最大50件
    fs.writeFileSync(RECENT_IMAGES_PATH, JSON.stringify(images, null, 2));
  } catch (e) { console.error('Failed to save recent image:', e); }
}
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
    // 🌟 問題用か解説用かでファイル名の頭文字を分ける
    const prefix = file.fieldname === 'exp_image_file' ? 'quiz-exp-' : 'quiz-';
    cb(null, prefix + uniqueSuffix + ext); 
  }
});
const upload = multer({ storage: storage });

// 🌟 問題画像と解説画像の2つのファイルを同時に受け取れるように設定
const quizUploadFields = upload.fields([
  { name: 'image_file', maxCount: 1 },
  { name: 'exp_image_file', maxCount: 1 }
]);

app.get('/', async (req, res) => {
  try {
    const SPREADSHEET_CSV_URL = process.env.SPREADSHEET_CSV_URL;
    const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL;

    const separator = SPREADSHEET_CSV_URL.includes('?') ? '&' : '?';
    const [csvResponse, settingsResponse] = await Promise.all([
      axios.get(`${SPREADSHEET_CSV_URL}${separator}t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache', 'Expires': '0' } }),
      axios.get(`${GAS_WEB_APP_URL}?action=getSettings&t=${Date.now()}`)
    ]);

    const allQuizData = parse(csvResponse.data, { columns: true, skip_empty_lines: true });
    const currentSettings = settingsResponse.data || { playTime: 20, questionCount: 5 };
    
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
              <input type="hidden" name="old_exp_image" value="${quiz.exp_image || ''}">
              
              <div class="form-row">
                <div class="form-group"> <label>🏷️ ジャンル（大区分）</label> <input type="text" name="genre" class="form-control" value="${quiz.genre || ''}" required> </div>
                <div class="form-group"> <label>📂 小区分（単元名など）</label> <input type="text" name="sub_genre" class="form-control" value="${quiz.sub_genre || ''}" placeholder="例: αアミノ酸"> </div>
                <div class="form-group"> <label>⭐ 難易度</label> <input type="number" name="difficulty" class="form-control" min="1" max="5" value="${quiz.difficulty || 1}" required> </div>
              </div>
              <div class="form-group"> <label>❓ 問題文</label> <textarea name="question" class="form-control" rows="3" required>${quiz.question || ''}</textarea> </div>
              <div class="form-group"> <label>✅ 正解</label> <input type="text" name="answer" class="form-control" value="${quiz.answer || ''}" required> </div>
              <div class="form-group"> <label>💡 解説（任意）</label> <textarea name="explanation" class="form-control" rows="2">${quiz.explanation || ''}</textarea> </div>
              
              <div class="form-row">
                <div class="form-group">
                  <label>🖼️ 問題画像の変更</label>
                  <div style="display:flex; gap:0.5rem; margin-bottom:0.5rem;">
                    <button type="button" onclick="openImagePool('edit_image_url_${quizId}')" style="padding:0.4rem 0.8rem; background:#005bac; color:#fff; border:none; border-radius:4px; font-size:0.8rem; cursor:pointer; font-weight:bold;">🖼️ 画像プールから選ぶ</button>
                  </div>
                  <input type="text" id="edit_image_url_${quizId}" name="image_url" class="form-control" placeholder="新しい画像URL (入力または選択)" style="margin-bottom:0.5rem;">
                  <input type="file" name="image_file" class="form-control" accept="image/*">
                  <div style="font-size: 0.8rem; color: #64748b; margin-top: 4px;">※推奨サイズ 5MB以下（ファイルを選択した場合はURLより優先されます）</div>
                </div>
                <div class="form-group">
                  <label>💡 解説画像の変更</label>
                  <div style="display:flex; gap:0.5rem; margin-bottom:0.5rem;">
                    <button type="button" onclick="openImagePool('edit_exp_image_url_${quizId}')" style="padding:0.4rem 0.8rem; background:#005bac; color:#fff; border:none; border-radius:4px; font-size:0.8rem; cursor:pointer; font-weight:bold;">🖼️ 画像プールから選ぶ</button>
                  </div>
                  <input type="text" id="edit_exp_image_url_${quizId}" name="exp_image_url" class="form-control" placeholder="新しい画像URL (入力または選択)" style="margin-bottom:0.5rem;">
                  <input type="file" name="exp_image_file" class="form-control" accept="image/*">
                  <div style="font-size: 0.8rem; color: #64748b; margin-top: 4px;">※推奨サイズ 5MB以下</div>
                </div>
              </div>

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
              <input type="checkbox" class="quiz-select-checkbox" value="${quizId}" onchange="updateBulkDeleteButton()">
              <span class="id-badge"># ${quizId}</span>
              <span class="genre-badge">${quiz.genre || 'ジャンルなし'}</span>
              ${quiz.sub_genre ? `<span class="sub-genre-badge">📂 ${quiz.sub_genre}</span>` : ''}
              <span class="diff-badge">⭐ ${quiz.difficulty || '1'}</span>
            </div>
            <h3>Q. ${quiz.question}</h3>
            <p><strong>A.</strong> <span class="answer">${quiz.answer}</span></p>
            ${quiz.explanation ? `<p class="explanation">💡 ${quiz.explanation}</p>` : ''}
            
            <div style="margin-top: 0.5rem; font-size: 0.85rem; display: flex; flex-direction: column; gap: 2px;">
              ${quiz.image ? `<p class="has-image" style="margin:0;">🖼️ 問題画像: ${quiz.image}</p>` : ''}
              ${quiz.exp_image ? `<p class="has-image" style="margin:0; color:#009944;">💡 解説画像: ${quiz.exp_image}</p>` : ''}
            </div>
            
            <div class="card-actions">
              <a href="/?edit_id=${quizId}" class="edit-link-btn">✏️ 編集</a>
              <form action="/delete-quiz" method="POST" onsubmit="return confirm('本当にこのクイズを削除してもよろしいですか？');" style="margin:0;">
                <input type="hidden" name="id" value="${quizId}">
                <button type="submit" class="delete-btn">🗑️ 削除</button>
              </form>
            </div>
          </div>
        `;
      }
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="ja">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>みんなで暗記！ TUATダッシュボード</title>
        <style>
          body { 
            font-family: 'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', 'Segoe UI', sans-serif; 
            margin: 0; padding: 2rem; line-height: 1.6;
            background: linear-gradient(135deg, #005bac 0%, #009944 100%);
            color: #222222; position: relative; overflow-x: hidden; min-height: 100vh;
          }
          .bg-shapes { 
            position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
            z-index: -1; overflow: hidden; pointer-events: none; margin: 0; padding: 0;
          }
          .shape { 
            position: absolute; display: block; list-style: none; 
            background: rgba(255, 255, 255, 0.35); 
            animation: float 22s linear infinite; bottom: -150px; 
          }
          .shape:nth-child(1) { left: 25%; width: 80px; height: 80px; animation-delay: 0s; }
          .shape:nth-child(2) { left: 10%; width: 30px; height: 30px; animation-delay: 2s; animation-duration: 12s; border-radius: 50%; }
          .shape:nth-child(3) { left: 70%; width: 25px; height: 25px; animation-delay: 4s; }
          .shape:nth-child(4) { left: 40%; width: 60px; height: 60px; animation-delay: 0s; animation-duration: 18s; border-radius: 50%; }
          .shape:nth-child(5) { left: 65%; width: 20px; height: 20px; animation-delay: 0s; }
          .shape:nth-child(6) { left: 75%; width: 110px; height: 110px; animation-delay: 3s; }
          .shape:nth-child(7) { left: 35%; width: 130px; height: 130px; animation-delay: 7s; }
          .shape:nth-child(8) { left: 50%; width: 25px; height: 25px; animation-delay: 15s; animation-duration: 45s; }
          .shape:nth-child(9) { left: 20%; width: 15px; height: 15px; animation-delay: 2s; animation-duration: 35s; border-radius: 50%; }
          .shape:nth-child(10) { left: 85%; width: 140px; height: 140px; animation-delay: 0s; animation-duration: 11s; }

          @keyframes float {
            0% { transform: translateY(0) rotate(0deg); opacity: 1; border-radius: 10%; }
            100% { transform: translateY(-1000px) rotate(540deg); opacity: 0; border-radius: 50%; }
          }

          .container { 
            max-width: 1200px; margin: 0 auto; 
            background: rgba(255, 255, 255, 0.88); 
            backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            padding: 2.5rem; border-radius: 20px; 
            box-shadow: 0 15px 35px rgba(0,0,0,0.15); position: relative; z-index: 1; 
          }
          
          .header { text-align: center; margin-bottom: 2rem; }
          h1 { font-size: 2.8rem; background: linear-gradient(to right, #005bac, #009944); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.5rem; letter-spacing: 1px; font-weight: 800; }
          .header p { color: #445566; font-size: 1.1rem; font-weight: bold; }
          
          .settings-accordion {
            max-width: 600px; margin: 0 auto 1.5rem auto; background: rgba(255, 255, 255, 0.95); border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.05); border-left: 6px solid #005bac; overflow: hidden;
          }
          .accordion-toggle {
            padding: 1rem 1.5rem; font-weight: bold; color: #005bac;
            cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none;
          }
          .accordion-toggle::after { content: '▼'; font-size: 0.8rem; transition: transform 0.2s; }
          .settings-accordion.open .accordion-toggle::after { transform: rotate(180deg); }
          .accordion-content {
            padding: 0 1.5rem 1.5rem 1.5rem; display: none; border-top: 1px solid #f1f5f9;
          }
          .settings-accordion.open .accordion-content { display: block; }
          
          .csv-panel { background: rgba(255, 255, 255, 0.95); border-top: 6px solid #005bac; padding: 2rem; border-radius: 12px; max-width: 600px; margin: 0 auto 1.5rem auto; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.05); }
          .csv-panel h3 { margin-top: 0; font-size: 1.3rem; color: #005bac; display: flex; align-items: center; gap: 8px; margin-bottom: 0.5rem; }
          .csv-panel p { font-size: 0.9rem; color: #556677; margin-bottom: 1.5rem; margin-top: 0; }
          .csv-flex { display: flex; flex-direction: column; gap: 15px; }
          .csv-form { display: flex; flex-direction: column; gap: 6px; margin: 0; background: #f8fafc; padding: 1rem; border-radius: 8px; border: 1px dashed #cbd5e1; }
          .csv-input { padding: 6px; background: white; border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
          .csv-btn { background: #005bac; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 0.9rem; transition: background 0.2s; }
          .csv-btn:hover { background: #004480; }
          .csv-dl-link { text-align: center; display: block; text-decoration: none; background: #fff; color: #64748b; border: 1px dashed #cbd5e1; padding: 8px 14px; border-radius: 6px; font-size: 0.85rem; font-weight: bold; transition: all 0.2s; }
          .csv-dl-link:hover { background: #f1f5f9; color: #1e293b; }
          
          .csv-maker-link { 
            display: block; text-decoration: none; background: #009944; color: white; 
            padding: 1.2rem; border-radius: 10px; font-size: 1.2rem; font-weight: bold; 
            text-align: center; box-shadow: 0 6px 20px rgba(0, 153, 68, 0.3); 
            transition: all 0.2s; border: none;
          }
          .csv-maker-link:hover { background: #007a36; transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0, 153, 68, 0.4); }

          .form-container { background: rgba(255, 255, 255, 0.95); border-top: 6px solid #009944; padding: 2rem; border-radius: 12px; max-width: 600px; margin: 0 auto 3rem auto; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08); }
          .form-container h2 { margin-top: 0; font-size: 1.4rem; color: #009944; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.8rem; margin-bottom: 1.5rem; }
          .form-group { margin-bottom: 1.2rem; }
          .form-group label { display: block; margin-bottom: 0.5rem; font-weight: bold; color: #3b4a5a; font-size: 0.95rem; }
          .form-control { width: 100%; padding: 0.75rem; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; color: #222222; font-size: 1rem; box-sizing: border-box; transition: all 0.2s; }
          .form-control:focus { outline: none; border-color: #009944; box-shadow: 0 0 0 3px rgba(0, 153, 68, 0.15); background: #ffffff; }
          .form-row { display: flex; gap: 1rem; }
          .form-row .form-group { flex: 1; }
          
          .submit-btn { width: 100%; padding: 1rem; background: #009944; color: white; border: none; border-radius: 8px; font-size: 1.1rem; font-weight: bold; cursor: pointer; transition: background 0.2s; margin-top: 1rem; box-shadow: 0 4px 10px rgba(0, 153, 68, 0.2); }
          .submit-btn:hover { background: #007a36; }
          .settings-save-btn { width: 100%; padding: 0.8rem; background: #005bac; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; transition: background 0.2s; }
          .settings-save-btn:hover { background: #004480; }

          .bulk-action-bar { margin: 0 auto 1.5rem auto; display: flex; justify-content: flex-end; align-items: center; gap: 1rem; background: rgba(255, 255, 255, 0.95); padding: 0.8rem 1.5rem; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
          .bulk-delete-btn { background: #e11d48; color: white; border: none; padding: 0.5rem 1.2rem; border-radius: 6px; font-weight: bold; cursor: pointer; display: none; transition: opacity 0.2s; }
          .bulk-delete-btn:hover { opacity: 0.9; }

          .tabs-container { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 2rem; justify-content: center; }
          .tab-btn { background: #ffffff; border: 2px solid #e2e8f0; color: #475569; padding: 0.5rem 1.5rem; border-radius: 9999px; font-weight: bold; cursor: pointer; transition: all 0.2s; font-size: 0.9rem; }
          .tab-btn:hover { border-color: #005bac; color: #005bac; }
          .tab-btn.active { background: #005bac; border-color: #005bac; color: #ffffff; }

          .quiz-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem; margin: 0 auto; }
          .quiz-card { background: rgba(255, 255, 255, 0.95); border-top: 5px solid #005bac; padding: 1.5rem; border-radius: 12px; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.04); display: flex; flex-direction: column; justify-content: space-between; transition: transform 0.2s; position: relative; }
          .quiz-card:hover { transform: translateY(-3px); box-shadow: 0 8px 15px rgba(0, 0, 0, 0.08); }
          .quiz-select-checkbox { transform: scale(1.4); margin-right: 0.8rem; cursor: pointer; accent-color: #e11d48; }

          .editing-card { border: 2px solid #009944 !important; border-top: 6px solid #009944 !important; background: #f0fdf4 !important; }
          .id-badge { display: inline-block; background: #e2e8f0; color: #475569; padding: 0.3rem 0.6rem; border-radius: 6px; font-size: 0.8rem; font-weight: bold; margin-right: 0.5rem; }
          .genre-badge { display: inline-block; background: #005bac; color: white; padding: 0.3rem 0.8rem; border-radius: 9999px; font-size: 0.8rem; font-weight: bold; margin-right: 0.5rem; }
          .sub-genre-badge { display: inline-block; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; padding: 0.3rem 0.8rem; border-radius: 9999px; font-size: 0.8rem; font-weight: bold; margin-right: 0.5rem; }
          .diff-badge { display: inline-block; background: #ff9900; color: white; padding: 0.3rem 0.6rem; border-radius: 9999px; font-size: 0.8rem; font-weight: bold; }
          .quiz-card h3 { margin: 0 0 1rem 0; font-size: 1.15rem; color: #1e293b; line-height: 1.5; }
          .answer { color: #009944; font-weight: bold; font-size: 1.1rem; }
          .explanation { font-size: 0.9rem; color: #556677; margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed #cbd5e1; line-height: 1.6; }
          .has-image { font-size: 0.85rem; color: #005bac; margin-top: 0.5rem; font-weight: bold; }
          
          .card-actions { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
          .edit-link-btn { background: #f1f5f9; color: #005bac; border: 1px solid #cbd5e1; padding: 0.4rem 1rem; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 0.9rem; text-align: center; flex: 1; transition: all 0.2s; }
          .edit-link-btn:hover { background: #005bac; color: white; }
          .delete-btn { background: #fff1f2; border: 1px solid #fecdd3; color: #e11d48; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.9rem; transition: all 0.2s; }
          .delete-btn:hover { background: #e11d48; color: white; }
          .save-btn { background: #009944; color: white; border: none; padding: 0.6rem 1rem; border-radius: 6px; font-weight: bold; cursor: pointer; flex: 1; }
          .cancel-btn { background: #e2e8f0; color: #475569; padding: 0.6rem 1rem; border-radius: 6px; text-decoration: none; font-weight: bold; text-align: center; flex: 1; }
        </style>
      </head>
      <body>
        <ul class="bg-shapes">
          <li class="shape"></li><li class="shape"></li><li class="shape"></li>
          <li class="shape"></li><li class="shape"></li><li class="shape"></li>
          <li class="shape"></li><li class="shape"></li><li class="shape"></li><li class="shape"></li>
        </ul>

        <div class="container">
          <div class="header">
            <h1>🎓 みんなで暗記！</h1>
            <p>東京農工大学 クイズ管理ダッシュボード（全 ${allQuizData.length} 問）</p>
            
            <div style="margin-top: 1rem;">
              <a href="/how-to-use" style="display: inline-block; background: #ff9900; color: white; text-decoration: none; padding: 0.6rem 1.5rem; border-radius: 9999px; font-weight: bold; box-shadow: 0 4px 10px rgba(255,153,0,0.3); transition: transform 0.2s;">
                📖 使い方ガイドを開く
              </a>
            </div>
          </div>

          <div class="settings-accordion" id="settingsAccordion">
            <div class="accordion-toggle" onclick="toggleAccordion()">🛠️ Discordゲーム設定を編集する</div>
            <div class="accordion-content">
              <form action="/save-settings" method="POST" style="margin-top:1rem;">
                <div class="form-row">
                  <div class="form-group">
                    <label for="playTime">⏱️ 1問の制限時間 (秒)</label>
                    <input type="number" id="playTime" name="playTime" class="form-control" value="${currentSettings.playTime}" min="5" max="120" required>
                  </div>
                  <div class="form-group">
                    <label for="questionCount">📝 1ゲームの問題数 (問)</label>
                    <input type="number" id="questionCount" name="questionCount" class="form-control" value="${currentSettings.questionCount}" min="1" max="50" required>
                  </div>
                </div>
                <button type="submit" class="settings-save-btn">⚙️ 設定をスプレッドシートに保存</button>
              </form>
            </div>
          </div>

          <div class="csv-panel">
            <h3>📝 みんなで新しいクイズを作ろう！</h3>
            <p>パソコンやExcelが苦手なメンバーでも、ゲーム感覚で新しい問題をまとめて作れる安心ページです。</p>
            
            <div class="csv-flex">
              <a href="/formula-editor" class="csv-maker-link" style="background: linear-gradient(135deg, #7c3aed, #2563eb); border-color: #7c3aed;">
                🧪 数式・構造式エディタを開く（化学式・Fischer式・Haworth式）
              </a>

              <a href="/csv-generator" class="csv-maker-link">
                📝 メンバー用：問題セットをつくってみる！
              </a>

              <form action="/upload-csv" method="POST" enctype="multipart/form-data" class="csv-form">
                <span style="font-size: 0.85rem; font-weight: bold; color: #475569;">📥 メンバーから貰ったファイルをここにセットして登録：</span>
                <div style="display: flex; gap: 8px; margin-top: 0.3rem;">
                  <input type="file" name="csv_file" accept=".csv" required class="csv-input" style="flex: 1;">
                  <button type="submit" class="csv-btn">🚀 登録する</button>
                </div>
              </form>

              <a href="/download-csv" class="csv-dl-link">
                💾 管理者用：全データのバックアップ（ファイルを保存）
              </a>
            </div>
          </div>

          <div class="form-container">
            <h2>➕ 新しいクイズを1問だけ追加する</h2>
            <form action="/add-quiz" method="POST" enctype="multipart/form-data">
              <div class="form-row">
                <div class="form-group"> <label for="genre">🏷️ ジャンル（大区分） *</label> <input type="text" id="genre" name="genre" class="form-control" placeholder="例: 有機化学, 生化学" required> </div>
                <div class="form-group"> <label for="sub_genre">📂 小区分（単元名など）</label> <input type="text" id="sub_genre" name="sub_genre" class="form-control" placeholder="例: αアミノ酸, 糖"> </div>
                <div class="form-group"> <label for="difficulty">⭐ 難易度 (1〜5)</label> <input type="number" id="difficulty" name="difficulty" class="form-control" min="1" max="5" value="1" required> </div>
              </div>
              <div class="form-group"> <label for="question">❓ 問題文 *</label> <textarea id="question" name="question" class="form-control" rows="3" placeholder="問題文を入力してください" required></textarea> </div>
              <div class="form-group"> <label for="answer">✅ 正解の答え *</label> <input type="text" id="answer" name="answer" class="form-control" placeholder="正解となる単語" required> </div>
              <div class="form-group"> <label for="explanation">💡 解説（任意）</label> <textarea id="explanation" name="explanation" class="form-control" rows="2" placeholder="解説文"></textarea> </div>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="image_file">🖼️ クイズ用の問題画像（任意）</label>
                  <div style="display:flex; gap:0.5rem; margin-bottom:0.5rem;">
                    <button type="button" onclick="openImagePool('image_url')" style="padding:0.4rem 0.8rem; background:#005bac; color:#fff; border:none; border-radius:4px; font-size:0.8rem; cursor:pointer; font-weight:bold;">🖼️ 画像プールから選ぶ</button>
                  </div>
                  <input type="text" id="image_url" name="image_url" class="form-control" placeholder="画像URL（プールから選択、または直接入力）" style="margin-bottom:0.5rem;">
                  <input type="file" id="image_file" name="image_file" class="form-control" accept="image/*">
                  <div style="font-size: 0.85rem; color: #e11d48; margin-top: 4px; font-weight: bold;">※ファイルを選択した場合はURLより優先されます</div>
                </div>
                <div class="form-group">
                  <label for="exp_image_file">💡 正解発表・解説時の画像（任意）</label>
                  <div style="display:flex; gap:0.5rem; margin-bottom:0.5rem;">
                    <button type="button" onclick="openImagePool('exp_image_url')" style="padding:0.4rem 0.8rem; background:#005bac; color:#fff; border:none; border-radius:4px; font-size:0.8rem; cursor:pointer; font-weight:bold;">🖼️ 画像プールから選ぶ</button>
                  </div>
                  <input type="text" id="exp_image_url" name="exp_image_url" class="form-control" placeholder="画像URL（プールから選択、または直接入力）" style="margin-bottom:0.5rem;">
                  <input type="file" id="exp_image_file" name="exp_image_file" class="form-control" accept="image/*">
                  <div style="font-size: 0.85rem; color: #e11d48; margin-top: 4px; font-weight: bold;">※ファイルを選択した場合はURLより優先されます</div>
                </div>
              </div>

              <button type="submit" class="submit-btn">✨ 登録する</button>
            </form>
          </div>

          <div class="tabs-container">
            ${tabsHtml}
          </div>

          <div class="bulk-action-bar">
            <span id="selected-count-text">選択されていません</span>
            <form action="/delete-quiz" method="POST" id="bulk-delete-form" onsubmit="return confirm('選択したクイズをすべて削除してもよろしいですか？');" style="margin:0;">
              <input type="hidden" name="id" id="bulk-delete-ids" value="">
              <button type="submit" class="bulk-delete-btn" id="bulk-delete-btn">🗑️ 選択したクイズをまとめて削除</button>
            </form>
          </div>

          <div class="quiz-grid">
            ${quizCardsHtml}
          </div>
        </div>

        <script>
          function toggleAccordion() {
            const accordion = document.getElementById('settingsAccordion');
            accordion.classList.toggle('open');
          }

          function filterCards(genre, btnElement) {
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            btnElement.classList.add('active');
            document.querySelectorAll('.quiz-card').forEach(card => {
              if (genre === 'すべて' || card.dataset.genre === genre) { card.style.display = 'flex'; } else { card.style.display = 'none'; }
            });
          }

          function updateBulkDeleteButton() {
            const checkboxes = document.querySelectorAll('.quiz-select-checkbox:checked');
            const btn = document.getElementById('bulk-delete-btn');
            const text = document.getElementById('selected-count-text');
            const hiddenInput = document.getElementById('bulk-delete-ids');
            
            if (checkboxes.length > 0) {
              const ids = Array.from(checkboxes).map(cb => cb.value);
              hiddenInput.value = ids.join(',');
              text.textContent = ids.length + ' 件 of クイズを選択中';
              btn.style.display = 'inline-block';
            } else {
              hiddenInput.value = '';
              text.textContent = '選択されていません';
              btn.style.display = 'none';
            }
          }
        </script>

      <!-- 画像プールモーダル -->
      <div id="image-pool-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; align-items:center; justify-content:center; backdrop-filter: blur(4px);">
        <div style="background:#fff; width:90%; max-width:800px; max-height:85vh; border-radius:12px; display:flex; flex-direction:column; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
          <div style="padding:1.5rem; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0; color:#005bac;">🖼️ 画像プール (最近アップロード・作成した画像)</h3>
            <button type="button" onclick="closeImagePool()" style="background:none; border:none; font-size:1.8rem; color:#64748b; cursor:pointer; line-height:1;">&times;</button>
          </div>
          <div id="image-pool-grid" style="padding:1.5rem; flex:1; overflow-y:auto; display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:1.5rem; background:#f8fafc;">
            <!-- 読み込み中 -->
            <div style="grid-column: 1 / -1; text-align: center; color: #64748b; padding: 2rem;">⏳ 読み込み中...</div>
          </div>
        </div>
      </div>

      <script>
        let currentPoolTargetId = null;

        function openImagePool(targetId) {
          currentPoolTargetId = targetId;
          document.getElementById('image-pool-modal').style.display = 'flex';
          fetch('/api/recent-images').then(r => r.json()).then(images => {
            const grid = document.getElementById('image-pool-grid');
            if (images.length === 0) {
              grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #64748b; padding: 2rem;">画像履歴がありません。数式・構造式エディタで保存するとここに表示されます。</div>';
              return;
            }
            grid.innerHTML = images.map(img => 
              '<div onclick="selectImageFromPool(\\'' + img.url + '\\')" style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:0.5rem; cursor:pointer; transition:all 0.2s; box-shadow:0 2px 5px rgba(0,0,0,0.05);" onmouseover="this.style.borderColor=\\'#005bac\\'; this.style.transform=\\'translateY(-2px)\\';" onmouseout="this.style.borderColor=\\'#e2e8f0\\'; this.style.transform=\\'none\\';">' +
              '<div style="height:120px; display:flex; align-items:center; justify-content:center; background:#f1f5f9; border-radius:4px; overflow:hidden; margin-bottom:0.5rem;"><img src="' + img.url + '" style="max-width:100%; max-height:100%; object-fit:contain;"></div>' +
              '<div style="font-size:0.7rem; color:#94a3b8; text-align:center;">' + new Date(img.timestamp).toLocaleString() + '</div>' +
              '</div>'
            ).join('');
          }).catch(e => {
            document.getElementById('image-pool-grid').innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #e11d48; padding: 2rem;">読み込みエラー</div>';
          });
        }
        function closeImagePool() { document.getElementById('image-pool-modal').style.display = 'none'; }
        function selectImageFromPool(url) {
          if (currentPoolTargetId) { document.getElementById(currentPoolTargetId).value = url; }
          closeImagePool();
        }
      </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('ダッシュボードでのクイズ読み込みエラー:', error);
    res.send('<h2 style="color:#e11d48; text-align:center;">エラーが発生しました。</h2>');
  }
});

// 📖 使い方ガイド
app.get('/how-to-use', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>使い方ガイド - みんなで暗記！</title>
      <style>
        body { 
          font-family: 'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', sans-serif; 
          margin: 0; padding: 2rem; line-height: 1.6;
          background: linear-gradient(135deg, #005bac 0%, #009944 100%);
          color: #222222; position: relative; overflow-x: hidden;
        }
        .bg-shapes { 
          position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
          z-index: -1; overflow: hidden; pointer-events: none; margin: 0; padding: 0;
        }
        .shape { 
          position: absolute; display: block; list-style: none; 
          background: rgba(255, 255, 255, 0.35); 
          animation: float 22s linear infinite; bottom: -150px; 
        }
        .shape:nth-child(1) { left: 25%; width: 80px; height: 80px; animation-delay: 0s; }
        .shape:nth-child(2) { left: 10%; width: 30px; height: 30px; animation-delay: 2s; animation-duration: 12s; border-radius: 50%; }
        .shape:nth-child(3) { left: 70%; width: 25px; height: 25px; animation-delay: 4s; }
        .shape:nth-child(4) { left: 40%; width: 60px; height: 60px; animation-delay: 0s; animation-duration: 18s; border-radius: 50%; }
        .shape:nth-child(5) { left: 65%; width: 20px; height: 20px; animation-delay: 0s; }
        .shape:nth-child(6) { left: 75%; width: 110px; height: 110px; animation-delay: 3s; }
        .shape:nth-child(7) { left: 35%; width: 130px; height: 130px; animation-delay: 7s; }
        .shape:nth-child(8) { left: 50%; width: 25px; height: 25px; animation-delay: 15s; animation-duration: 45s; }
        .shape:nth-child(9) { left: 20%; width: 15px; height: 15px; animation-delay: 2s; animation-duration: 35s; border-radius: 50%; }
        .shape:nth-child(10) { left: 85%; width: 140px; height: 140px; animation-delay: 0s; animation-duration: 11s; }

        @keyframes float {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; border-radius: 10%; }
          100% { transform: translateY(-1000px) rotate(540deg); opacity: 0; border-radius: 50%; }
        }

        .container { 
          max-width: 800px; margin: 0 auto; 
          background: rgba(255, 255, 255, 0.88); 
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          padding: 2.5rem; border-radius: 20px; 
          box-shadow: 0 15px 35px rgba(0,0,0,0.15); 
          border-top: 6px solid #005bac; position: relative; z-index: 1; 
        }
        h1 { color: #005bac; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; margin-top: 0; }
        h2 { color: #009944; margin-top: 2rem; border-bottom: 1px dashed #e2e8f0; padding-bottom: 0.5rem; }
        .back-btn { display: inline-block; margin-bottom: 1.5rem; color: #ffffff; text-decoration: none; font-weight: bold; background: #005bac; padding: 0.5rem 1rem; border-radius: 6px; transition: all 0.2s; }
        .back-btn:hover { background: #004480; transform: translateY(-2px); }
        .cmd { display: inline-block; background: #ffe4e6; color: #e11d48; padding: 0.2rem 0.6rem; border-radius: 4px; font-family: monospace; font-weight: bold; margin-right: 0.5rem; }
        .card { background: rgba(248, 250, 252, 0.95); border-left: 4px solid #005bac; padding: 1rem; margin-bottom: 1rem; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.02); }
      </style>
    </head>
    <body>
      <ul class="bg-shapes">
        <li class="shape"></li><li class="shape"></li><li class="shape"></li>
        <li class="shape"></li><li class="shape"></li><li class="shape"></li>
        <li class="shape"></li><li class="shape"></li><li class="shape"></li><li class="shape"></li>
      </ul>

      <div class="container">
        <a href="/" class="back-btn">← ダッシュボードに戻る</a>
        <h1>📖 クイズBot 使い方ガイド</h1>
        
        <h2>1. Discordでの遊び方（コマンド一覧）</h2>
        <div class="card">
          <p><span class="cmd">/game</span> <strong>カスタムゲームロビーを開く（おすすめ！）</strong><br>
          みんなで遊ぶメイン機能です。モード、ジャンル、制限時間、問題数を自由に設定して対戦できます。</p>
        </div>
        <div class="card" style="border-left-color: #009944;">
          <p><span class="cmd">/quiz</span> <strong>単発AI4択クイズ</strong><br>
          ランダムに1問出題されます。ダミーの選択肢はAIがその場で自動生成します。</p>
        </div>
        <div class="card" style="border-left-color: #ff9900;">
          <p><span class="cmd">/quick-quiz</span> <strong>本格ガチ早押しクイズ</strong><br>
          ボタンを押して解答権を獲得し、文字を入力して答えるテレビ番組のようなモードです。</p>
        </div>

        <h2>2. 3つのゲームモード（/game専用）</h2>
        <ul>
          <li><strong>🏆 通常スコア:</strong> 早押しで高得点。全問終了時に最高得点の人が勝ち！</li>
          <li><strong>💀 サバイバル:</strong> ライフ3でスタート。時間切れや不正解でライフが減り、0で脱落。</li>
          <li><strong>🎲 ベッティング:</strong> 所持ポイントを賭ける変則ルール。自信のある問題で一発逆転！</li>
        </ul>

        <h2>3. 神機能：出題ジャンルの増やし方</h2>
        <p>管理画面の「➕ 新しいクイズを追加する」から、ジャンルの入力欄に<strong>「新しいジャンル名」を直接手入力して登録するだけ</strong>で、自動的にDiscordのメニューにも追加されます！</p>
      </div>
    </body>
    </html>
  `);
});

// ==========================================================
// 🧪 数式・構造式エディタ
// ==========================================================
app.get('/formula-editor', (req, res) => {
  try {
    const htmlPath = path.join(__dirname, 'public', 'formula-editor.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    res.type('html').send(html);
  } catch (e) {
    console.error('formula-editor.html not found:', e.message);
    res.send(`
      <div style="background:#e11d48; color:#fff; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif; text-align:center; padding:2rem;">
        <h1>⚠️ エディタファイルが見つかりません</h1>
        <p>public/formula-editor.html をプロジェクトのルートディレクトリに配置してください。</p>
        <p style="font-size:0.85rem; opacity:0.8;">エラー: ${e.message}</p>
        <a href="/" style="margin-top:1rem; color:#fff; font-weight:bold;">← ダッシュボードに戻る</a>
      </div>
    `);
  }
});

// ==========================================================
// 🖼️ 1. ジェネレータ用：画像を先行してGASに送り、URLをもらうAPI
// ==========================================================
app.post('/api/upload-image-single', quizUploadFields, async (req, res) => {
  try {
    let file = null;
    if (req.files && req.files['image_file']) file = req.files['image_file'][0];
    if (req.files && req.files['exp_image_file']) file = req.files['exp_image_file'][0];

    if (!file) return res.status(400).json({ error: '画像ファイルが見つかりません' });

    // Base64に変換してGASに投げる
    const base64Data = fs.readFileSync(file.path, 'base64');
    const postData = {
      action: 'upload_image_only',
      image_base64: base64Data,
      image_mime: file.mimetype,
      image_name: file.originalname
    };
    
    // 一時ファイルは削除
    fs.unlinkSync(file.path);

    // GASに送信して、完成したGoogleドライブのURLを受け取る
    const response = await axios.post(process.env.GAS_WEB_APP_URL, postData);
    
    // GAS側から { url: "https://drive.google.com/..." } が返ってくる
    if (response.data && response.data.url) {
      addRecentImage(response.data.url);
      res.json({ url: response.data.url });
    } else {
      throw new Error("URLが返却されませんでした");
    }
  } catch (error) {
    console.error('先行アップロードエラー:', error);
    res.status(500).json({ error: 'サーバー側で画像保存に失敗しました' });
  }
});

// ==========================================================
// 🌟 2. 一問ずつ追加タブからの送信処理（単発POST - エラー検知版）
// ==========================================================
app.post('/add-quiz', quizUploadFields, async (req, res) => {
  try {
    const { genre, sub_genre, difficulty, question, answer, explanation, image_url, exp_image_url } = req.body;
    let postData = { action: 'add', genre, sub_genre: sub_genre || '', difficulty, question, answer, explanation: explanation || '', image: image_url || '', exp_image: exp_image_url || '' };

    if (req.files && req.files['image_file']) {
      const file = req.files['image_file'][0];
      postData.image_base64 = fs.readFileSync(file.path, 'base64');
      postData.image_mime = file.mimetype; postData.image_name = file.originalname;
      fs.unlinkSync(file.path);
    }
    if (req.files && req.files['exp_image_file']) {
      const file = req.files['exp_image_file'][0];
      postData.exp_image_base64 = fs.readFileSync(file.path, 'base64');
      postData.exp_image_mime = file.mimetype; postData.exp_image_name = file.originalname;
      fs.unlinkSync(file.path);
    }

    // GASにデータを送信
    const response = await axios.post(process.env.GAS_WEB_APP_URL, postData);
    
    // 🌟 GASから返ってきた文字をチェックし、"Error" という文字が含まれていたら画面に表示する
    if (typeof response.data === 'string' && response.data.includes('Error')) {
      console.error("❌ GAS側でエラーが発生しました:", response.data);
      return res.send(`
        <div style="background:#d9534f; color:#fff; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif; padding:20px; text-align:center;">
          <h1>❌ GAS（Google）側でエラーが発生しました</h1>
          <p style="background:rgba(0,0,0,0.2); padding:15px; border-radius:5px; font-family:monospace; max-width:800px; word-wrap:break-word;">
            ${response.data}
          </p>
          <button onclick="window.history.back()" style="margin-top:20px; padding:10px 20px; background:#fff; color:#d9534f; border:none; border-radius:5px; cursor:pointer; font-weight:bold;">戻る</button>
        </div>
      `);
    }

    res.send(`<div style="background:#009944; color:#fff; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;"><h1>🎉 クイズを登録しました！</h1><p>画像はドライブの「クイズ用」フォルダに保存されました。</p><script>setTimeout(() => { window.location.href = '/'; }, 1500);</script></div>`);
  } catch (error) { 
    console.error("❌ Node.js通信エラー:", error);
    res.send('<h2 style="text-align:center;">クイズ登録中に通信エラーが発生しました。</h2>'); 
  }
});

// ==========================================================
// 🌟 3. 既存問題の編集時の送信処理（上書きPOST）
// ==========================================================
app.post('/edit-quiz', quizUploadFields, async (req, res) => {
  try {
    const { id, genre, sub_genre, difficulty, question, answer, explanation, old_image, old_exp_image, image_url, exp_image_url } = req.body;
    let postData = { action: 'edit', id, genre, sub_genre: sub_genre || '', difficulty, question, answer, explanation: explanation || '', image: image_url || old_image || '', exp_image: exp_image_url || old_exp_image || '' };

    if (req.files && req.files['image_file']) {
      const file = req.files['image_file'][0];
      postData.image_base64 = fs.readFileSync(file.path, 'base64');
      postData.image_mime = file.mimetype; postData.image_name = file.originalname;
      fs.unlinkSync(file.path);
    }
    if (req.files && req.files['exp_image_file']) {
      const file = req.files['exp_image_file'][0];
      postData.exp_image_base64 = fs.readFileSync(file.path, 'base64');
      postData.exp_image_mime = file.mimetype; postData.exp_image_name = file.originalname;
      fs.unlinkSync(file.path);
    }

    await axios.post(process.env.GAS_WEB_APP_URL, postData);
    res.send(`<div style="background:#005bac; color:#fff; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;"><h1>💾 クイズを上書き保存しました！</h1><script>setTimeout(() => { window.location.href = '/'; }, 1500);</script></div>`);
  } catch (error) { res.send('<h2 style="text-align:center;">クイズ編集中にエラーが発生しました。</h2>'); }
});

// ==========================================================
// 🌟 4. CSV登録画面（/import-csv等）からの一括処理
// ==========================================================
app.post('/save-csv-quiz', async (req, res) => {
  try {
    const { quizzes } = req.body; 
    if (!quizzes || !Array.isArray(quizzes)) return res.status(400).send('データ不正');

    for (const quiz of quizzes) {
      // CSVジェネレータで事前に取得したURLが quiz.image や quiz.exp_image に入っている
      let postData = {
        action: 'add',
        genre: quiz.genre, sub_genre: quiz.sub_genre || '', difficulty: quiz.difficulty || '3',
        question: quiz.question, answer: quiz.answer, explanation: quiz.explanation || '',
        image: quiz.image || '', exp_image: quiz.exp_image || '' 
      };
      await axios.post(process.env.GAS_WEB_APP_URL, postData);
    }
    res.json({ success: true, message: `${quizzes.length}件を一括登録しました！` });
  } catch (error) { res.status(500).json({ success: false }); }
});

// 💻 かんたん問題セットメーカー（画像先行アップロード対応版）
app.get('/csv-generator', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>かんたん問題セットメーカー</title>
      <style>
        body { 
          font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 2rem; line-height: 1.6;
          background: linear-gradient(135deg, #005bac 0%, #009944 100%); color: #222222; min-height: 100vh;
        }
        .container { 
          max-width: 900px; margin: 0 auto; background: rgba(255, 255, 255, 0.92); 
          backdrop-filter: blur(12px); padding: 2.5rem; border-radius: 20px; box-shadow: 0 15px 35px rgba(0,0,0,0.15); 
        }
        .back-btn { display: inline-block; margin-bottom: 1.5rem; color: #ffffff; text-decoration: none; font-weight: bold; background: #005bac; padding: 0.5rem 1rem; border-radius: 6px; }
        h1 { color: #009944; margin-top: 0; font-size: 2rem; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; }
        p.desc { color: #556677; font-size: 0.95rem; margin-bottom: 2rem; }
        
        .maker-layout { display: grid; grid-template-columns: 1fr; gap: 2rem; }
        @media(min-width: 768px) { .maker-layout { grid-template-columns: 380px 1fr; } }
        
        .form-box { background: white; padding: 1.5rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border-top: 5px solid #009944; height: fit-content; }
        .form-group { margin-bottom: 1rem; }
        .form-group label { display: block; margin-bottom: 0.4rem; font-weight: bold; font-size: 0.9rem; color: #3b4a5a; }
        .form-control { width: 100%; padding: 0.6rem; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; font-size: 0.95rem; }
        .form-control:focus { outline: none; border-color: #009944; background: #fff; }
        .form-row { display: flex; gap: 0.5rem; }
        .form-row .form-group { flex: 1; margin-bottom: 0; }
        
        /* 🌟 画像アップロード中の演出用スタイル */
        .img-status { font-size: 0.75rem; margin-top: 3px; font-weight: bold; color: #64748b; }
        .img-status.success { color: #009944; }
        .img-status.loading { color: #005bac; }
        
        .add-list-btn { width: 100%; padding: 0.8rem; background: #009944; color: white; border: none; border-radius: 6px; font-weight: bold; font-size: 1rem; cursor: pointer; transition: background 0.2s; margin-top: 1rem; }
        .add-list-btn:hover { background: #007a36; }
        
        .list-box { background: white; padding: 1.5rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border-top: 5px solid #005bac; display: flex; flex-direction: column; }
        .list-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid #f1f5f9; }
        .list-count { font-weight: bold; color: #005bac; font-size: 1.1rem; }
        
        .download-btn { background: #ff9900; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 0.95rem; box-shadow: 0 4px 8px rgba(255,153,0,0.25); }
        .download-btn:hover { background: #e08800; }
        
        .preview-scroll { max-height: 500px; overflow-y: auto; padding-right: 5px; }
        .draft-item { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #005bac; padding: 0.8rem; margin-bottom: 0.8rem; border-radius: 0 6px 6px 0; position: relative; }
        .draft-tags { font-size: 0.75rem; font-weight: bold; color: #64748b; margin-bottom: 0.3rem; }
        .draft-tags span { background: #e2e8f0; padding: 2px 6px; border-radius: 4px; margin-right: 4px; }
        .draft-q { font-weight: bold; margin: 0; font-size: 0.95rem; color: #1e293b; padding-right: 2rem; }
        .draft-a { margin: 3px 0 0 0; font-size: 0.85rem; color: #009944; font-weight: bold; }
        .draft-images { font-size: 0.8rem; margin: 4px 0 0 0; color: #005bac; display: flex; flex-direction: column; gap: 1px; }
        .remove-draft-btn { position: absolute; top: 8px; right: 8px; background: none; border: none; color: #e11d48; font-weight: bold; cursor: pointer; font-size: 1.1rem; }
        .empty-text { color: #94a3b8; text-align: center; padding: 3rem 0; font-style: italic; }
      </style>
    </head>
    <body>
      <div class="container">
        <a href="/" class="back-btn">← 管理画面に戻る</a>
        <h1>📝 かんたん問題セットメーカー</h1>
        <p class="desc">
          フォームを埋めるだけで新しいクイズのセットをまとめて安全に作成できます。<br>
          <strong>🌟 画像付き問題にも完全対応！</strong> 画像を選択すると、自動的にサーバーへ先行アップロードされ、CSVファイルにファイル名が記録されます。作り終わったら右側の黄色いボタンからCSVファイルを保存して、管理画面からアップロードしてください！
        </p>
        
        <div class="maker-layout">
          <div class="form-box">
            <div class="form-group"> <label>🏷️ ジャンル（大区分） *</label> <input type="text" id="g_genre" class="form-control" placeholder="例: 有機化学, アニメ" required> </div>
            <div class="form-group"> <label>📂 小区分（単元名など）</label> <input type="text" id="g_sub" class="form-control" placeholder="例: αアミノ酸"> </div>
            <div class="form-group"> <label>⭐ 難易度 (1〜5)</label> <input type="number" id="g_diff" class="form-control" min="1" max="5" value="1"> </div>
            <div class="form-group"> <label>❓ 問題文 *</label> <textarea id="g_question" class="form-control" rows="3" placeholder="問題文を入力してください" required></textarea> </div>
            <div class="form-group"> <label>✅ 正解の答え *</label> <input type="text" id="g_answer" class="form-control" placeholder="正解となる単語" required> </div>
            <div class="form-group"> <label>💡 解説（任意）</label> <textarea id="g_exp" class="form-control" rows="2" placeholder="解説文"></textarea> </div>
            
            <input type="hidden" id="g_img_filename" value="">
            <input type="hidden" id="g_exp_img_filename" value="">

            <div class="form-group">
              <label>🖼️ クイズ用の問題画像 (任意)</label>
              <input type="file" id="g_img_file" class="form-control" accept="image/*" onchange="uploadImageAsync('image_file')">
              <div id="g_img_status" class="img-status">未選択</div>
            </div>
            
            <div class="form-group">
              <label>💡 正解発表・解説時の画像 (任意)</label>
              <input type="file" id="g_exp_img_file" class="form-control" accept="image/*" onchange="uploadImageAsync('exp_image_file')">
              <div id="g_exp_img_status" class="img-status">未選択</div>
            </div>

            <button type="button" class="add-list-btn" onclick="addQuizToList()">➕ 下書きリストに追加</button>
          </div>
          
          <div class="list-box">
            <div class="list-header">
              <div class="list-count">📋 下書きリスト (<span id="count-num">0</span> 件)</div>
              <button type="button" class="download-btn" onclick="downloadCSV()">📥 完成したファイルを保存する</button>
            </div>
            
            <div class="preview-scroll" id="preview-area">
              <div class="empty-text">まだデータがありません。左のフォームから追加してください。</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 画像プールモーダル -->
      <div id="image-pool-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; align-items:center; justify-content:center; backdrop-filter: blur(4px);">
        <div style="background:#fff; width:90%; max-width:800px; max-height:85vh; border-radius:12px; display:flex; flex-direction:column; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
          <div style="padding:1.5rem; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0; color:#005bac;">🖼️ 画像プール (最近アップロード・作成した画像)</h3>
            <button type="button" onclick="closeImagePool()" style="background:none; border:none; font-size:1.8rem; color:#64748b; cursor:pointer; line-height:1;">&times;</button>
          </div>
          <div id="image-pool-grid" style="padding:1.5rem; flex:1; overflow-y:auto; display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:1.5rem; background:#f8fafc;">
            <!-- 読み込み中 -->
            <div style="grid-column: 1 / -1; text-align: center; color: #64748b; padding: 2rem;">⏳ 読み込み中...</div>
          </div>
        </div>
      </div>

      <script>
        let quizList = [];
        let currentPoolTargetId = null;

        function openImagePool(targetId) {
          currentPoolTargetId = targetId;
          document.getElementById('image-pool-modal').style.display = 'flex';
          fetch('/api/recent-images').then(r => r.json()).then(images => {
            const grid = document.getElementById('image-pool-grid');
            if (images.length === 0) {
              grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #64748b; padding: 2rem;">画像履歴がありません。</div>';
              return;
            }
            grid.innerHTML = images.map(img => 
              '<div onclick="selectImageFromPool(\\'' + img.url + '\\')" style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:0.5rem; cursor:pointer; transition:all 0.2s; box-shadow:0 2px 5px rgba(0,0,0,0.05);" onmouseover="this.style.borderColor=\\'#005bac\\'; this.style.transform=\\'translateY(-2px)\\';" onmouseout="this.style.borderColor=\\'#e2e8f0\\'; this.style.transform=\\'none\\';">' +
              '<div style="height:120px; display:flex; align-items:center; justify-content:center; background:#f1f5f9; border-radius:4px; overflow:hidden; margin-bottom:0.5rem;"><img src="' + img.url + '" style="max-width:100%; max-height:100%; object-fit:contain;"></div>' +
              '<div style="font-size:0.7rem; color:#94a3b8; text-align:center;">' + new Date(img.timestamp).toLocaleString() + '</div>' +
              '</div>'
            ).join('');
          }).catch(e => {
            document.getElementById('image-pool-grid').innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #e11d48; padding: 2rem;">読み込みエラー</div>';
          });
        }
        function closeImagePool() { document.getElementById('image-pool-modal').style.display = 'none'; }
        function selectImageFromPool(url) {
          if (currentPoolTargetId) { document.getElementById(currentPoolTargetId).value = url; }
          closeImagePool();
        }

  // 🌟 画像を選んだ瞬間に裏側でGASへアップロードしてURLをもらう
        async function uploadImageAsync(fieldName) {
          const fileInput = fieldName === 'image_file' ? document.getElementById('g_img_file') : document.getElementById('g_exp_img_file');
          const statusDiv = fieldName === 'image_file' ? document.getElementById('g_img_status') : document.getElementById('g_exp_img_status');
          const hiddenInput = fieldName === 'image_file' ? document.getElementById('g_img_filename') : document.getElementById('g_exp_img_filename');

          if (!fileInput.files || fileInput.files.length === 0) return;

          statusDiv.className = 'img-status loading';
          statusDiv.textContent = '⏳ ドライブの「クイズ用」フォルダに保存中...';

          const formData = new FormData();
          formData.append(fieldName, fileInput.files[0]);

          try {
            const response = await fetch('/api/upload-image-single', { method: 'POST', body: formData });
            const data = await response.json();

            // 💡 サーバーからファイル名ではなく「ドライブのURL」が直接返ってくる
            if (response.ok && data.url) {
              hiddenInput.value = data.url; // CSVには直接URLを埋め込む
              statusDiv.className = 'img-status success';
              statusDiv.textContent = '✅ 保存完了！(URL取得済)';
            } else {
              throw new Error(data.error || '不明なエラー');
            }
          } catch (error) {
            console.error(error);
            alert('アップロードに失敗しました。');
            statusDiv.className = 'img-status';
            statusDiv.textContent = '❌ 失敗しました';
            fileInput.value = '';
          }
        }

        function addQuizToList() {
          const genre = document.getElementById('g_genre').value.trim();
          const sub_genre = document.getElementById('g_sub').value.trim();
          const difficulty = document.getElementById('g_diff').value || 1;
          const question = document.getElementById('g_question').value.trim();
          const answer = document.getElementById('g_answer').value.trim();
          const explanation = document.getElementById('g_exp').value.trim();
          const image = document.getElementById('g_img_filename').value;        // 🌟 隠し欄から取得
          const exp_image = document.getElementById('g_exp_img_filename').value; // 🌟 隠し欄から取得

          if (!genre || !question || !answer) {
            alert('「ジャンル」「問題文」「正解の答え」は必須入力です！');
            return;
          }

          const newQuiz = { genre, sub_genre, difficulty, question, answer, explanation, image, exp_image };
          quizList.push(newQuiz);

          // 入力欄をリセット
          document.getElementById('g_question').value = '';
          document.getElementById('g_answer').value = '';
          document.getElementById('g_exp').value = '';
          
          document.getElementById('g_img_file').value = '';
          document.getElementById('g_exp_img_file').value = '';
          document.getElementById('g_img_filename').value = '';
          document.getElementById('g_exp_img_filename').value = '';
          
          document.getElementById('g_img_status').className = 'img-status';
          document.getElementById('g_img_status').textContent = '未選択';
          document.getElementById('g_exp_img_status').className = 'img-status';
          document.getElementById('g_exp_img_status').textContent = '未選択';

          updatePreview();
        }

        function removeQuiz(index) {
          quizList.splice(index, 1);
          updatePreview();
        }

        function updatePreview() {
          const area = document.getElementById('preview-area');
          const countSpan = document.getElementById('count-num');
          countSpan.textContent = quizList.length;

          if (quizList.length === 0) {
            area.innerHTML = '<div class="empty-text">まだデータがありません。左のフォームから追加してください。</div>';
            return;
          }

          let html = '';
          quizList.forEach((q, idx) => {
            html += \`
              <div class="draft-item">
                <div class="draft-tags">
                  <span>🏷️ \${escapeHtml(q.genre)}</span>
                  \${q.sub_genre ? \`<span>📂 \${escapeHtml(q.sub_genre)}</span>\` : ''}
                  <span>⭐ \${q.difficulty}</span>
                </div>
                <p class="draft-q">Q. \${escapeHtml(q.question)}</p>
                <p class="draft-a">A. \${escapeHtml(q.answer)}</p>
                
                <div class="draft-images">
                  \${q.image ? \`<span>🖼️ 問題画像: \${escapeHtml(q.image)}</span>\` : ''}
                  \${q.exp_image ? \`<span style="color:#009944;">💡 解説画像: \${escapeHtml(q.exp_image)}</span>\` : ''}
                </div>

                <button type="button" class="remove-draft-btn" onclick="removeQuiz(\${idx})">×</button>
              </div>
            \`;
          });
          area.innerHTML = html;
        }

        function escapeHtml(str) {
          if(!str) return '';
          return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        }

        function downloadCSV() {
          if (quizList.length === 0) {
            alert('下書きリストにクイズが1件も入っていません！');
            return;
          }

          let csvContent = 'genre,sub_genre,difficulty,question,answer,explanation,image,exp_image\\n';
          
          quizList.forEach(q => {
            const escape = (str) => \`"\${(str || '').replace(/"/g, '""')}"\`;
            csvContent += \`\${escape(q.genre)},\${escape(q.sub_genre)},\${q.difficulty},\${escape(q.question)},\${escape(q.answer)},\${escape(q.explanation)},\${escape(q.image)},\${escape(q.exp_image)}\\n\`;
          });

          const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
          const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
          
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.setAttribute('href', url);
          link.setAttribute('download', 'tuat_quiz_draft.csv'); 
          link.style.visibility = 'hidden';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      </script>
    </body>
    </html>
  `);
});

// 設定保存
app.post('/save-settings', async (req, res) => {
  try {
    const { playTime, questionCount } = req.body;
    await axios.get(process.env.GAS_WEB_APP_URL, { params: { action: 'updateSettings', playTime, questionCount } });
    res.send(`<div style="background:#005bac; color:#fff; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;"><h1>⚙️ 設定を保存しました！</h1><p>画面を戻しています...</p><script>setTimeout(() => { window.location.href = '/'; }, 1500);</script></div>`);
  } catch (error) { res.send('<h2 style="text-align:center;">設定の保存中にエラーが発生しました。</h2>'); }
});

// 🛠️ クイズ追加 (🌟 Googleドライブ自動転送・POST対応版)
app.post('/add-quiz', quizUploadFields, async (req, res) => {
  try {
    const { genre, sub_genre, difficulty, question, answer, explanation } = req.body;
    
    // GASのdoPostへ送るベースデータを構築
    let postData = {
      action: 'add',
      genre: genre,
      sub_genre: sub_genre || '',
      difficulty: difficulty,
      question: question,
      answer: answer,
      explanation: explanation || ''
    };

    // 🖼️ 問題画像がある場合、Base64文字列に変換してセット
    if (req.files && req.files['image_file']) {
      const file = req.files['image_file'][0];
      postData.image_base64 = fs.readFileSync(file.path, 'base64');
      postData.image_mime = file.mimetype;
      postData.image_name = file.originalname;
      
      // 送信後はサーバーの容量を圧迫しないよう、ローカルの一時ファイルは即時削除
      fs.unlinkSync(file.path);
    }

    // 💡 解説画像がある場合、Base64文字列に変換してセット
    if (req.files && req.files['exp_image_file']) {
      const file = req.files['exp_image_file'][0];
      postData.exp_image_base64 = fs.readFileSync(file.path, 'base64');
      postData.exp_image_mime = file.mimetype;
      postData.exp_image_name = file.originalname;
      
      fs.unlinkSync(file.path);
    }

    // 🚀 GASウェブアプリURLへ、axios.post でデータを一撃送信！
    await axios.post(process.env.GAS_WEB_APP_URL, postData);

    res.send(`<div style="background:#009944; color:#fff; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;"><h1>🎉 クイズを登録しました！</h1><p>画像はGoogleドライブへ自動保存されました。画面を戻しています...</p><script>setTimeout(() => { window.location.href = '/'; }, 1500);</script></div>`);
  } catch (error) {
    console.error('クイズ登録エラー💦', error);
    res.send('<h2 style="text-align:center;">クイズ登録中にエラーが発生しました。</h2>');
  }
});

// 🛠️ クイズ編集 (🌟 Googleドライブ自動転送・POST対応版)
app.post('/edit-quiz', quizUploadFields, async (req, res) => {
  try {
    const { id, genre, sub_genre, difficulty, question, answer, explanation, old_image, old_exp_image } = req.body;
    
    let postData = {
      action: 'edit',
      id: id,
      genre: genre,
      sub_genre: sub_genre || '',
      difficulty: difficulty,
      question: question,
      answer: answer,
      explanation: explanation || '',
      image: old_image || '',       // 新しい画像がない場合は古いURLを維持
      exp_image: old_exp_image || '' // 新しい画像がない場合は古いURLを維持
    };

    // 🖼️ 新しい問題画像がアップロードされた場合
    if (req.files && req.files['image_file']) {
      const file = req.files['image_file'][0];
      postData.image_base64 = fs.readFileSync(file.path, 'base64');
      postData.image_mime = file.mimetype;
      postData.image_name = file.originalname;
      
      fs.unlinkSync(file.path);
    }

    // 💡 新しい解説画像がアップロードされた場合
    if (req.files && req.files['exp_image_file']) {
      const file = req.files['exp_image_file'][0];
      postData.exp_image_base64 = fs.readFileSync(file.path, 'base64');
      postData.exp_image_mime = file.mimetype;
      postData.exp_image_name = file.originalname;
      
      fs.unlinkSync(file.path);
    }

    // 🚀 GASへ上書きデータをポスト送信！
    await axios.post(process.env.GAS_WEB_APP_URL, postData);

    res.send(`<div style="background:#005bac; color:#fff; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;"><h1>💾 クイズを上書き保存しました！</h1><p>画面を戻しています...</p><script>setTimeout(() => { window.location.href = '/'; }, 1500);</script></div>`);
  } catch (error) {
    console.error('クイズ編集エラー💦', error);
    res.send('<h2 style="text-align:center;">クイズ編集中にエラーが発生しました。</h2>');
  }
});

// クイズ削除
app.post('/delete-quiz', async (req, res) => {
  try {
    await axios.get(process.env.GAS_WEB_APP_URL, { params: { action: 'delete', id: req.body.id } });
    res.send(`<div style="background:#e11d48; color:#fff; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;"><h1>🗑️ 削除しました</h1><p>画面を更新しています...</p><script>setTimeout(() => { window.location.href = '/'; }, 1000);</script></div>`);
  } catch (error) { res.send('<h2 style="text-align:center;">エラーが発生しました。</h2>'); }
});

// ==========================================================
// 📥 ファイルからクイズを一括登録する (🌟 exp_image 列に対応)
// ==========================================================
app.post('/upload-csv', upload.single('csv_file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.send('<h2>⚠️ ファイルがアップロードされていません。</h2><a href="/">戻る</a>');
    }

    const csvData = fs.readFileSync(req.file.path, 'utf8');
    const records = parse(csvData, {
      columns: true,       
      skip_empty_lines: true, 
      trim: true,
      bom: true 
    });

    console.log(`📦 ファイルから ${records.length} 件 of データを検出しました。登録を開始します...`);

    for (const record of records) {
      await axios.get(process.env.GAS_WEB_APP_URL, {
        params: {
          action: 'add',
          genre: record.genre || '',
          sub_genre: record.sub_genre || '', 
          difficulty: record.difficulty || 1,
          question: record.question || '',
          answer: record.answer || '',
          explanation: record.explanation || '',
          image: record.image || '',       // 🌟 ファイル内指定があれば引き継ぐ
          exp_image: record.exp_image || '' // 🌟 解説画像も一括対応
        }
      });
    }

    fs.unlinkSync(req.file.path);

    res.send(`
      <div style="background:#009944; color:#fff; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;">
        <h1>🎉 ${records.length}件のクイズを一括登録しました！</h1>
        <p>まもなくダッシュボードに戻ります...</p>
        <script>setTimeout(() => { window.location.href = '/'; }, 2000);</script>
      </div>
    `);

  } catch (error) {
    console.error('一括登録エラー:', error);
    res.status(500).send('<h2>❌ ファイルの解析または登録中にエラーが発生しました。</h2><a href="/">戻る</a>');
  }
});

// ==========================================================
// 📤 ダウンロード (🌟 exp_image 列のエクスポートに対応)
// ==========================================================
app.get('/download-csv', async (req, res) => {
  try {
    const SPREADSHEET_CSV_URL = process.env.SPREADSHEET_CSV_URL;
    const separator = SPREADSHEET_CSV_URL.includes('?') ? '&' : '?';
    const response = await axios.get(`${SPREADSHEET_CSV_URL}${separator}t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache', 'Expires': '0' } });
    const allQuizData = parse(response.data, { columns: true, skip_empty_lines: true });
    
    // ヘッダーに exp_image をバッチリ追加
    let csvContent = 'genre,sub_genre,difficulty,question,answer,explanation,image,exp_image\n';
    
    for (const q of allQuizData) {
      const escape = (str) => `"${(str || '').replace(/"/g, '""')}"`;
      csvContent += `${escape(q.genre)},${escape(q.sub_genre)},${q.difficulty || 1},${escape(q.question)},${escape(q.answer)},${escape(q.explanation)},${escape(q.image)},${escape(q.exp_image)}\n`;
    }
    
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    const buffer = Buffer.concat([bom, Buffer.from(csvContent, 'utf8')]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=tuat_quiz_backup.csv');
    res.send(buffer);

  } catch (error) {
    console.error('ダウンロードエラー:', error);
    res.status(500).send('データのダウンロードに失敗しました。');
  }
});

app.listen(PORT, () => { console.log(`🌐 Webサーバーがポート ${PORT} で起動しました！`); });

client.login(process.env.BOT_TOKEN);
