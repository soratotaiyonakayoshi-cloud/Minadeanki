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
// 🌐 魔法のWebダッシュボード制御エリア
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use('/images', express.static(path.join(__dirname, 'images')));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'images/');
  },
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
    const response = await axios.get(SPREADSHEET_CSV_URL, {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache', 'Expires': '0' }
    });
    const allQuizData = parse(response.data, { columns: true, skip_empty_lines: true });

    const editId = req.query.edit_id || null;

    let quizCardsHtml = '';
    for (const quiz of allQuizData) {
      const quizId = quiz.id || '-';

      if (editId && quizId.toString() === editId.toString()) {
        quizCardsHtml += `
          <div class="quiz-card editing-card">
            <span class="id-badge"># ${quizId} を編集中</span>
            <form action="/edit-quiz" method="POST" enctype="multipart/form-data" style="margin-top: 1rem;">
              <input type="hidden" name="id" value="${quizId}">
              <input type="hidden" name="old_image" value="${quiz.image || ''}">
              
              <div class="form-row">
                <div class="form-group">
                  <label>🏷️ ジャンル</label>
                  <input type="text" name="genre" class="form-control" value="${quiz.genre || ''}" required>
                </div>
                <div class="form-group">
                  <label>⭐ 難易度</label>
                  <input type="number" name="difficulty" class="form-control" min="1" max="5" value="${quiz.difficulty || 1}" required>
                </div>
              </div>

              <div class="form-group">
                <label>❓ 問題文</label>
                <textarea name="question" class="form-control" rows="3" required>${quiz.question || ''}</textarea>
              </div>

              <div class="form-group">
                <label>✅ 正解</label>
                <input type="text" name="answer" class="form-control" value="${quiz.answer || ''}" required>
              </div>

              <div class="form-group">
                <label>💡 解説（任意）</label>
                <textarea name="explanation" class="form-control" rows="2">${quiz.explanation || ''}</textarea>
              </div>

              <div class="form-group">
                <label>🖼️ 画像の変更（現在の画像: ${quiz.image || 'なし'}）</label>
                <input type="file" name="image_file" class="form-control" accept="image/*">
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
          <div class="quiz-card">
            <div class="card-header-tags">
              <span class="id-badge"># ${quizId}</span>
              <span class="genre-badge">${quiz.genre || 'ジャンルなし'}</span>
              <span class="diff-badge">⭐ ${quiz.difficulty || '1'}</span>
            </div>
            <h3>Q. ${quiz.question}</h3>
            <p><strong>A.</strong> <span class="answer">${quiz.answer}</span></p>
            ${quiz.explanation ? `<p class="explanation">💡 ${quiz.explanation}</p>` : ''}
            ${quiz.image ? `<p class="has-image">🖼️ 画像あり: ${quiz.image}</p>` : ''}
            
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
        <title>みんなで暗記！ ダッシュボード</title>
        <style>
          /* 🎓 ベースデザイン（白背景・明るい印象に） */
          body {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            background-color: #f4f7f6;
            color: #333333;
            margin: 0;
            padding: 2rem;
          }
          
          /* ヘッダーエリア */
          .header {
            text-align: center;
            margin-bottom: 3rem;
          }
          h1 {
            font-size: 2.8rem;
            /* 💡 コウケンブルーからハッケングリーンへのグラデーション！ */
            background: linear-gradient(to right, #175697, #349E5A);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.5rem;
            letter-spacing: 2px;
          }
          .header p {
            color: #555555;
            font-size: 1.1rem;
            font-weight: bold;
          }
          
          /* 📝 フォーム全体（クリーンな白ベース） */
          .form-container {
            background: #ffffff;
            border-top: 6px solid #349E5A; /* ハッケングリーンのアクセント */
            padding: 2rem;
            border-radius: 12px;
            max-width: 600px;
            margin: 0 auto 4rem auto;
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
          }
          .form-container h2 {
            margin-top: 0;
            font-size: 1.4rem;
            color: #175697; /* コウケンブルー */
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 0.8rem;
            margin-bottom: 1.5rem;
          }
          .form-group { margin-bottom: 1.2rem; }
          .form-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: bold;
            color: #4a5568;
            font-size: 0.95rem;
          }
          .form-control {
            width: 100%;
            padding: 0.75rem;
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            color: #333333;
            font-size: 1rem;
            box-sizing: border-box;
            transition: all 0.2s;
          }
          .form-control:focus {
            outline: none;
            border-color: #349E5A;
            box-shadow: 0 0 0 3px rgba(52, 158, 90, 0.2);
            background: #ffffff;
          }
          .form-row { display: flex; gap: 1rem; }
          .form-row .form-group { flex: 1; }
          
          /* 追加ボタン（ハッケングリーン） */
          .submit-btn {
            width: 100%;
            padding: 1rem;
            background: #349E5A;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 1.1rem;
            font-weight: bold;
            cursor: pointer;
            transition: background 0.2s;
            margin-top: 1rem;
            box-shadow: 0 4px 6px rgba(52, 158, 90, 0.3);
          }
          .submit-btn:hover { background: #2c864c; }

          /* 🗂️ クイズ一覧のグリッド */
          .quiz-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            gap: 1.5rem;
            max-width: 1200px;
            margin: 0 auto;
          }
          /* カードデザイン（コウケンブルーのアクセント） */
          .quiz-card {
            background: #ffffff;
            border-top: 5px solid #175697;
            padding: 1.5rem;
            border-radius: 12px;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            transition: transform 0.2s;
          }
          .quiz-card:hover { transform: translateY(-3px); box-shadow: 0 8px 15px rgba(0, 0, 0, 0.1); }
          
          /* 編集中のカード */
          .editing-card {
            border: 2px solid #349E5A !important;
            border-top: 6px solid #349E5A !important;
            background: #f0fdf4 !important;
          }

          /* タグ類 */
          .card-header-tags { margin-bottom: 1rem; }
          .id-badge {
            display: inline-block;
            background: #e2e8f0;
            color: #475569;
            padding: 0.3rem 0.6rem;
            border-radius: 6px;
            font-size: 0.8rem;
            font-weight: bold;
            margin-right: 0.5rem;
          }
          .genre-badge {
            display: inline-block;
            background: #175697; /* コウケンブルー */
            color: white;
            padding: 0.3rem 0.8rem;
            border-radius: 9999px;
            font-size: 0.8rem;
            font-weight: bold;
            margin-right: 0.5rem;
          }
          .diff-badge {
            display: inline-block;
            background: #f59e0b;
            color: white;
            padding: 0.3rem 0.6rem;
            border-radius: 9999px;
            font-size: 0.8rem;
            font-weight: bold;
          }
          .quiz-card h3 {
            margin: 0 0 1rem 0;
            font-size: 1.15rem;
            color: #1e293b;
            line-height: 1.5;
          }
          .answer {
            color: #349E5A; /* ハッケングリーン */
            font-weight: bold;
            font-size: 1.1rem;
          }
          .explanation {
            font-size: 0.9rem;
            color: #64748b;
            margin-top: 1rem;
            padding-top: 1rem;
            border-top: 1px dashed #cbd5e1;
            line-height: 1.6;
          }
          .has-image {
            font-size: 0.85rem;
            color: #175697;
            margin-top: 0.5rem;
            font-weight: bold;
          }
          
          /* ボタン操作エリア */
          .card-actions {
            margin-top: 1.5rem;
            padding-top: 1rem;
            border-top: 1px solid #f1f5f9;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 0.5rem;
          }
          .edit-link-btn {
            background: #f1f5f9;
            color: #175697;
            border: 1px solid #cbd5e1;
            padding: 0.4rem 1rem;
            border-radius: 6px;
            text-decoration: none;
            font-weight: bold;
            font-size: 0.9rem;
            text-align: center;
            flex: 1;
            transition: all 0.2s;
          }
          .edit-link-btn:hover { background: #175697; color: white; }
          
          .delete-btn {
            background: #fff1f2;
            border: 1px solid #fecdd3;
            color: #e11d48;
            padding: 0.4rem 0.8rem;
            border-radius: 6px;
            cursor: pointer;
            font-weight: bold;
            font-size: 0.9rem;
            transition: all 0.2s;
          }
          .delete-btn:hover { background: #e11d48; color: white; }

          /* 編集保存・キャンセルボタン */
          .save-btn {
            background: #349E5A;
            color: white;
            border: none;
            padding: 0.6rem 1rem;
            border-radius: 6px;
            font-weight: bold;
            cursor: pointer;
            flex: 1;
          }
          .cancel-btn {
            background: #e2e8f0;
            color: #475569;
            padding: 0.6rem 1rem;
            border-radius: 6px;
            text-decoration: none;
            font-weight: bold;
            text-align: center;
            flex: 1;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🎓 みんなで暗記！</h1>
          <p>クイズ管理ダッシュボード（全 ${allQuizData.length} 問）</p>
        </div>

        <div class="form-container">
          <h2>➕ 新しいクイズを追加する</h2>
          <form action="/add-quiz" method="POST" enctype="multipart/form-data">
            <div class="form-row">
              <div class="form-group">
                <label for="genre">🏷️ ジャンル</label>
                <input type="text" id="genre" name="genre" class="form-control" placeholder="例: 農学, 工学" required>
              </div>
              <div class="form-group">
                <label for="difficulty">⭐ 難易度 (1〜5)</label>
                <input type="number" id="difficulty" name="difficulty" class="form-control" min="1" max="5" value="1" required>
              </div>
            </div>
            <div class="form-group">
              <label for="question">❓ 問題文</label>
              <textarea id="question" name="question" class="form-control" rows="3" placeholder="問題文を入力してください" required></textarea>
            </div>
            <div class="form-group">
              <label for="answer">✅ 正解の答え</label>
              <input type="text" id="answer" name="answer" class="form-control" placeholder="正解となる単語" required>
            </div>
            <div class="form-group">
              <label for="explanation">💡 解説（任意）</label>
              <textarea id="explanation" name="explanation" class="form-control" rows="2" placeholder="解説文"></textarea>
            </div>
            <div class="form-group">
              <label for="image_file">🖼️ クイズ用の画像（任意）</label>
              <input type="file" id="image_file" name="image_file" class="form-control" accept="image/*">
            </div>
            <button type="submit" class="submit-btn">✨ スプレッドシートに登録する</button>
          </form>
        </div>

        <div class="quiz-grid">
          ${quizCardsHtml}
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('ダッシュボードでのクイズ読み込みエラー:', error);
    res.send('<h2 style="color:#e11d48; text-align:center;">エラーが発生しました。</h2>');
  }
});

// 各種処理後の画面も白背景に！
app.post('/add-quiz', upload.single('image_file'), async (req, res) => {
  try {
    const { genre, difficulty, question, answer, explanation } = req.body;
    const imageName = req.file ? req.file.filename : '';
    await axios.get(process.env.GAS_WEB_APP_URL, {
      params: { action: 'add', genre, difficulty, question, answer, explanation, image: imageName }
    });
    res.send(`<div style="background:#f4f7f6; color:#333; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;"><h1 style="color:#349E5A;">🎉 登録が完了しました！</h1><p>まもなく戻ります...</p><script>setTimeout(() => { window.location.href = '/'; }, 1500);</script></div>`);
  } catch (error) { res.send('<h2 style="text-align:center;">エラーが発生しました。</h2>'); }
});

app.post('/edit-quiz', upload.single('image_file'), async (req, res) => {
  try {
    const { id, genre, difficulty, question, answer, explanation, old_image } = req.body;
    const imageName = req.file ? req.file.filename : old_image;
    await axios.get(process.env.GAS_WEB_APP_URL, {
      params: { action: 'edit', id, genre, difficulty, question, answer, explanation, image: imageName }
    });
    res.send(`<div style="background:#f4f7f6; color:#333; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;"><h1 style="color:#175697;">💾 上書き保存が完了しました！</h1><p>まもなく戻ります...</p><script>setTimeout(() => { window.location.href = '/'; }, 1500);</script></div>`);
  } catch (error) { res.send('<h2 style="text-align:center;">エラーが発生しました。</h2>'); }
});

app.post('/delete-quiz', async (req, res) => {
  try {
    await axios.get(process.env.GAS_WEB_APP_URL, { params: { action: 'delete', id: req.body.id } });
    res.send(`<div style="background:#f4f7f6; color:#333; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;"><h1 style="color:#e11d48;">🗑️ 削除しました</h1><p>画面を更新しています...</p><script>setTimeout(() => { window.location.href = '/'; }, 1000);</script></div>`);
  } catch (error) { res.send('<h2 style="text-align:center;">エラーが発生しました。</h2>'); }
});

app.listen(PORT, () => {
  console.log(`🌐 Webサーバーがポート ${PORT} で起動しました！`);
});

client.login(process.env.BOT_TOKEN);
