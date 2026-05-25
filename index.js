require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const express = require('express');
const axios = require('axios');
const { parse } = require('csv-parse/sync');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// 📁 コマンド設定
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
    console.log('📱 全てのスラッシュコマンドの登録・更新が完了しました！');
  } catch (error) {
    console.error('スラッシュコマンドの登録エラー💦', error);
  }
});

// 📂 イベント読み込み
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

// Web画面のフォームから送られてきた文字データを解析できるようにする設定
app.use(express.urlencoded({ extended: true }));

// 🖼️ 画像フォルダの公開
app.use('/images', express.static(path.join(__dirname, 'images')));

// 🏠 ダッシュボードのトップページ（クイズ一覧 ＆ 新規追加 ＆ 編集切替）
app.get('/', async (req, res) => {
  try {
    const SPREADSHEET_CSV_URL = process.env.SPREADSHEET_CSV_URL;
    const response = await axios.get(SPREADSHEET_CSV_URL, {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache', 'Expires': '0' }
    });
    const allQuizData = parse(response.data, { columns: true, skip_empty_lines: true });

    // 💡 現在どのIDを編集しようとしているか（?edit_id=XX から取得。なければnull）
    const editId = req.query.edit_id || null;
    let targetQuiz = null;

    if (editId) {
      targetQuiz = allQuizData.find(q => q.id.toString() === editId.toString());
    }

    // クイズ一覧のカードHTMLを作成
    let quizCardsHtml = '';
    for (const quiz of allQuizData) {
      const quizId = quiz.id || '-';

      // 💡 もしこのカードが「編集対象」として選ばれていたら、カード自体を編集入力欄にする！
      if (editId && quizId.toString() === editId.toString()) {
        quizCardsHtml += `
          <div class="quiz-card editing-card">
            <span class="id-badge"># ${quizId} を編集欄</span>
            <form action="/edit-quiz" method="POST" style="margin-top: 1rem;">
              <input type="hidden" name="id" value="${quizId}">
              
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
                <label>🖼️ 画像名（任意）</label>
                <input type="text" name="image" class="form-control" value="${quiz.image || ''}">
              </div>

              <div style="display:flex; gap:0.5rem; margin-top:1rem;">
                <button type="submit" class="save-btn">💾 上書き保存</button>
                <a href="/" class="cancel-btn">キャンセル</a>
              </div>
            </form>
          </div>
        `;
      } else {
        // 通常時のカード表示（✏️編集ボタンを追加！）
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
            ${quiz.image ? `<p class="has-image">🖼️ 画像: ${quiz.image}</p>` : ''}
            
            <div class="card-actions">
              <a href="/?edit_id=${quizId}" class="edit-link-btn">✏️ 編集する</a>
              
              <form action="/delete-quiz" method="POST" onsubmit="return confirm('本当にこのクイズを削除してもよろしいですか？');" style="margin:0;">
                <input type="hidden" name="id" value="${quizId}">
                <button type="submit" class="delete-btn">🗑️ 削除</button>
              </form>
            </div>
          </div>
        `;
      }
    }

    // 画面全体のHTMLを送信
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
          
          /* フォーム全体のデザイン */
          .form-container {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 2rem;
            border-radius: 20px;
            max-width: 600px;
            margin: 0 auto 4rem auto;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
          }
          .form-container h2 {
            margin-top: 0;
            font-size: 1.5rem;
            color: #38bdf8;
            border-bottom: 2px solid rgba(56, 189, 248, 0.2);
            padding-bottom: 0.5rem;
            margin-bottom: 1.5rem;
          }
          .form-group {
            margin-bottom: 1.2rem;
          }
          .form-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: bold;
            color: #cbd5e1;
            font-size: 0.9rem;
          }
          .form-control {
            width: 100%;
            padding: 0.75rem;
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            color: white;
            font-size: 1rem;
            box-sizing: border-box;
          }
          .form-control:focus {
            outline: none;
            border-color: #38bdf8;
            box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
          }
          .form-row {
            display: flex;
            gap: 1rem;
          }
          .form-row .form-group {
            flex: 1;
          }
          .submit-btn {
            width: 100%;
            padding: 0.75rem;
            background: linear-gradient(to right, #3b82f6, #1d4ed8);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 1.1rem;
            font-weight: bold;
            cursor: pointer;
            transition: opacity 0.2s;
            margin-top: 1rem;
          }
          .submit-btn:hover {
            opacity: 0.9;
          }

          /* クイズ一覧のグリッド */
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
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
          /* 編集中のカードを目立たせる */
          .editing-card {
            border: 2px solid #eab308 !important;
            background: rgba(234, 179, 8, 0.05) !important;
          }
          .card-header-tags {
            margin-bottom: 1rem;
          }
          .id-badge {
            display: inline-block;
            background: rgba(255,255,255,0.15);
            color: #e2e8f0;
            padding: 0.3rem 0.6rem;
            border-radius: 6px;
            font-size: 0.8rem;
            font-weight: bold;
            margin-right: 0.5rem;
          }
          .genre-badge {
            display: inline-block;
            background: #3b82f6;
            color: white;
            padding: 0.3rem 0.8rem;
            border-radius: 9999px;
            font-size: 0.8rem;
            font-weight: bold;
            margin-right: 0.5rem;
          }
          .diff-badge {
            display: inline-block;
            background: #eab308;
            color: #1e1b4b;
            padding: 0.3rem 0.6rem;
            border-radius: 9999px;
            font-size: 0.8rem;
            font-weight: bold;
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
          
          /* ボタン操作エリア */
          .card-actions {
            margin-top: 1.5rem;
            padding-top: 1rem;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 0.5rem;
          }
          .edit-link-btn {
            background: rgba(56, 189, 248, 0.1);
            border: 1px solid #38bdf8;
            color: #38bdf8;
            padding: 0.4rem 1rem;
            border-radius: 8px;
            text-decoration: none;
            font-weight: bold;
            font-size: 0.9rem;
            text-align: center;
            flex: 1;
            transition: all 0.2s;
          }
          .edit-link-btn:hover {
            background: #38bdf8;
            color: #0f172a;
          }
          .delete-btn {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid #ef4444;
            color: #fca5a5;
            padding: 0.4rem 0.8rem;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
            font-size: 0.9rem;
            transition: all 0.2s;
          }
          .delete-btn:hover {
            background: #ef4444;
            color: white;
          }

          /* 編集保存・キャンセルボタン */
          .save-btn {
            background: #eab308;
            color: #1e1b4b;
            border: none;
            padding: 0.5rem 1rem;
            border-radius: 6px;
            font-weight: bold;
            cursor: pointer;
            flex: 1;
          }
          .cancel-btn {
            background: rgba(255,255,255,0.1);
            color: white;
            padding: 0.5rem 1rem;
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
          <h1>🔮 QUIZ BOT DASHBOARD</h1>
          <p>現在登録されているクイズ一覧（全 ${allQuizData.length} 問）</p>
        </div>

        <div class="form-container">
          <h2>➕ 新しいクイズを追加する</h2>
          <form action="/add-quiz" method="POST">
            <div class="form-row">
              <div class="form-group">
                <label for="genre">🏷️ ジャンル</label>
                <input type="text" id="genre" name="genre" class="form-control" placeholder="例: アニメ, 歴史" required>
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
              <input type="text" id="answer" name="answer" class="form-control" placeholder="4択の正解になる単語" required>
            </div>

            <div class="form-group">
              <label for="explanation">💡 解説（任意）</label>
              <textarea id="explanation" name="explanation" class="form-control" rows="2" placeholder="正解発表時に表示される解説文"></textarea>
            </div>

            <div class="form-group">
              <label for="image">🖼️ 画像ファイル名（任意）</label>
              <input type="text" id="image" name="image" class="form-control" placeholder="例: quiz1.png (※imagesフォルダ内の名前)">
            </div>

            <button type="submit" class="submit-btn">🚀 スプレッドシートに登録する</button>
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
    res.send('<h2 style="color:white; text-align:center;">エラーが発生しました。</h2>');
  }
});

// 🚀 フォームからデータを受け取ってGASに「追加」命令を送る設定
app.post('/add-quiz', async (req, res) => {
  try {
    const { genre, difficulty, question, answer, explanation, image } = req.body;
    const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL;

    await axios.get(GAS_WEB_APP_URL, {
      params: {
        action: 'add',
        genre: genre,
        difficulty: difficulty,
        question: question,
        answer: answer,
        explanation: explanation,
        image: image || '' 
      }
    });

    res.send(`
      <div style="background:#0f172a; color:white; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;">
        <h1 style="color:#4ade80;">🎉 スプレッドシートに登録が完了しました！</h1>
        <p style="color:#94a3b8;">まもなくダッシュボードに戻ります...</p>
        <script>
          setTimeout(() => { window.location.href = '/'; }, 2000);
        </script>
      </div>
    `);
  } catch (error) {
    console.error('ダッシュボードからの追加エラー💦', error);
    res.send('<h2 style="color:white; text-align:center;">登録中にエラーが発生しました。</h2>');
  }
});

// 🚀 【新設】編集後のデータを受け取って、GASに「編集(edit)」命令を送る設定
app.post('/edit-quiz', async (req, res) => {
  try {
    const { id, genre, difficulty, question, answer, explanation, image } = req.body;
    const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL;

    console.log(`✏️ ダッシュボードからID ${id} の修正データを受信しました`);

    // 💡 action: 'edit' を指定し、書き換えるターゲットのIDとデータを一緒にGASへ転送！
    await axios.get(GAS_WEB_APP_URL, {
      params: {
        action: 'edit',
        id: id,
        genre: genre,
        difficulty: difficulty,
        question: question,
        answer: answer,
        explanation: explanation,
        image: image || ''
      }
    });

    res.send(`
      <div style="background:#0f172a; color:white; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;">
        <h1 style="color:#eab308;">💾 スプレッドシートの上書き保存が完了しました！</h1>
        <p style="color:#94a3b8;">まもなくダッシュボードに戻ります...</p>
        <script>
          setTimeout(() => { window.location.href = '/'; }, 1500);
        </script>
      </div>
    `);
  } catch (error) {
    console.error('ダッシュボードからの編集エラー💦', error);
    res.send('<h2 style="color:white; text-align:center;">更新中にエラーが発生しました。</h2>');
  }
});

// 🚀 画面の削除ボタンからIDを受け取って、GASに「削除」命令を送る設定
app.post('/delete-quiz', async (req, res) => {
  try {
    const { id } = req.body;
    const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL;

    await axios.get(GAS_WEB_APP_URL, {
      params: {
        action: 'delete',
        id: id
      }
    });

    res.send(`
      <div style="background:#0f172a; color:white; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;">
        <h1 style="color:#ef4444;">🗑️ クイズを正常に消去しました</h1>
        <p style="color:#94a3b8;">画面を更新しています...</p>
        <script>
          setTimeout(() => { window.location.href = '/'; }, 1500);
        </script>
      </div>
    `);
  } catch (error) {
    console.error('ダッシュボードからの削除エラー💦', error);
    res.send('<h2 style="color:white; text-align:center;">削除中にエラーが発生しました。</h2>');
  }
});

// ⚡ サーバーの起動
app.listen(PORT, () => {
  console.log(`🌐 Webサーバーがポート ${PORT} で起動しました！`);
});

client.login(process.env.BOT_TOKEN);
