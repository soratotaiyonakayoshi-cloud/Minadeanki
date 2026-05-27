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
app.use('/ketcher', express.static(path.join(__dirname, 'public', 'ketcher')));

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

    const csvData = csvResponse.data;
    const records = parse(csvData, { columns: true, skip_empty_lines: true });

    let settings = { playTime: 20, questionCount: 5 };
    if (settingsResponse.data) settings = settingsResponse.data;

    let html = `
      <!DOCTYPE html>
      <html lang="ja">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>クイズBot ダッシュボード</title>
        <style>
          body { font-family: 'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', sans-serif; margin: 0; padding: 2rem; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #f8fafc; }
          .container { max-width: 1200px; margin: 0 auto; background: rgba(30, 41, 59, 0.95); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); padding: 2.5rem; border-radius: 24px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); }
          h1 { color: #38bdf8; text-align: center; font-size: 2.5rem; margin-bottom: 2rem; text-shadow: 0 2px 4px rgba(0,0,0,0.3); letter-spacing: 2px; }
          .header-buttons { display: flex; justify-content: center; gap: 1rem; margin-bottom: 2rem; }
          .btn { display: inline-block; padding: 0.75rem 1.5rem; font-size: 1rem; font-weight: bold; text-decoration: none; color: #ffffff; background: linear-gradient(to right, #3b82f6, #2563eb); border: none; border-radius: 12px; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
          .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.2); }
          .btn-green { background: linear-gradient(to right, #10b981, #059669); }
          .btn-red { background: linear-gradient(to right, #ef4444, #dc2626); }
          .btn-outline { background: transparent; border: 2px solid #38bdf8; color: #38bdf8; }
          .btn-outline:hover { background: rgba(56, 189, 248, 0.1); }
          .modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.75); backdrop-filter: blur(4px); align-items: center; justify-content: center; }
          .modal-content { background: #1e293b; padding: 2.5rem; border-radius: 24px; width: 90%; max-width: 600px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); max-height: 90vh; overflow-y: auto; }
          .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 1rem; }
          .modal-header h2 { margin: 0; color: #f8fafc; font-size: 1.5rem; }
          .close { color: #94a3b8; font-size: 28px; font-weight: bold; cursor: pointer; transition: color 0.2s; }
          .close:hover { color: #f8fafc; }
          .form-group { margin-bottom: 1.5rem; }
          .form-group label { display: block; margin-bottom: 0.5rem; font-weight: bold; color: #cbd5e1; }
          .form-control { width: 100%; padding: 0.75rem; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; font-size: 1rem; background: rgba(15, 23, 42, 0.5); color: #f8fafc; box-sizing: border-box; transition: border-color 0.2s; }
          .form-control:focus { outline: none; border-color: #38bdf8; box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2); }
          .image-input-group { display: flex; gap: 0.5rem; }
          .image-input-group .form-control { flex-grow: 1; }
          .file-input-wrapper { position: relative; overflow: hidden; display: inline-block; }
          .file-input-wrapper input[type=file] { font-size: 100px; position: absolute; left: 0; top: 0; opacity: 0; cursor: pointer; }
          .table-container { overflow-x: auto; margin-top: 2rem; background: rgba(15, 23, 42, 0.5); border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); }
          table { width: 100%; border-collapse: collapse; white-space: nowrap; }
          th, td { padding: 1rem; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); }
          th { background-color: rgba(56, 189, 248, 0.1); color: #38bdf8; font-weight: 600; text-transform: uppercase; font-size: 0.85rem; letter-spacing: 1px; position: sticky; top: 0; }
          tr:hover { background-color: rgba(255,255,255,0.02); }
          .table-image { max-width: 80px; max-height: 80px; border-radius: 4px; object-fit: cover; transition: transform 0.2s; cursor: pointer; }
          .table-image:hover { transform: scale(2); position: relative; z-index: 10; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5); }
          .action-buttons { display: flex; gap: 0.5rem; }
          
          .image-pool-grid {
            display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; max-height: 300px; overflow-y: auto;
            padding: 10px; background: rgba(15, 23, 42, 0.5); border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); margin-top: 10px;
          }
          .image-pool-item {
            background: #1e293b; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0.5rem; cursor: pointer;
            transition: all 0.2s; box-shadow: 0 2px 5px rgba(0,0,0,0.2);
          }
          .image-pool-item:hover { border-color: #38bdf8; transform: translateY(-2px); }
          .image-pool-item img { max-width: 100%; max-height: 100px; object-fit: contain; }
          .image-pool-date { font-size: 0.7rem; color: #94a3b8; text-align: center; margin-top: 5px; }

          /* Loading Spinner */
          .loader { border: 4px solid rgba(255,255,255,0.1); border-top: 4px solid #38bdf8; border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite; display: inline-block; vertical-align: middle; margin-right: 8px; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🚀 クイズBot ダッシュボード</h1>
          
          <div class="header-buttons">
            <a href="/formula-editor" target="_blank" class="btn btn-outline" style="font-size:1.1rem;">🧪 数式・構造式エディタを開く</a>
          </div>

          <div class="header-buttons" style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 2rem;">
            <button class="btn" onclick="openAddModal()">➕ 新しいクイズを追加する</button>
            <button class="btn btn-green" onclick="openSettingsModal()">⚙️ ゲーム設定を変更する</button>
            <button class="btn btn-red" onclick="deleteSelected()">🗑️ 選択したクイズを削除</button>
            <a href="/how-to-use" class="btn btn-outline">📖 使い方を見る</a>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" id="selectAll" onclick="toggleAll(this)"></th>
                  <th>ID</th>
                  <th>ジャンル</th>
                  <th>難易度</th>
                  <th>問題</th>
                  <th>解答</th>
                  <th>解説</th>
                  <th>問題画像</th>
                  <th>解説画像</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
    `;

    records.forEach(row => {
      let qImg = row['画像URL'] ? `<a href="${row['画像URL']}" target="_blank"><img src="${row['画像URL']}" class="table-image" alt="画像"></a>` : '-';
      let eImg = row['解説画像URL'] ? `<a href="${row['解説画像URL']}" target="_blank"><img src="${row['解説画像URL']}" class="table-image" alt="解説画像"></a>` : '-';
      
      html += `
        <tr>
          <td><input type="checkbox" class="rowCheckbox" value="${row['ID']}"></td>
          <td>${row['ID']}</td>
          <td><span style="background:rgba(56,189,248,0.2); color:#38bdf8; padding:0.25rem 0.5rem; border-radius:999px; font-size:0.85rem;">${row['ジャンル']}</span></td>
          <td>${row['難易度']}</td>
          <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;" title="${row['問題']}">${row['問題']}</td>
          <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis;" title="${row['解答']}">${row['解答']}</td>
          <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis;" title="${row['解説']}">${row['解説']}</td>
          <td>${qImg}</td>
          <td>${eImg}</td>
          <td>
            <div class="action-buttons">
              <button class="btn" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick='openEditModal(${JSON.stringify(row).replace(/'/g, "&#39;")})'>編集</button>
            </div>
          </td>
        </tr>
      `;
    });

    html += `
              </tbody>
            </table>
          </div>
        </div>

        <!-- ➕ 追加・編集モーダル -->
        <div id="addModal" class="modal">
          <div class="modal-content">
            <div class="modal-header">
              <h2 id="modalTitle">新しいクイズを追加</h2>
              <span class="close" onclick="closeAddModal()">&times;</span>
            </div>
            <form id="quizForm" enctype="multipart/form-data">
              <input type="hidden" id="quizId" name="id">
              
              <div class="form-group">
                <label>ジャンル (例: 化学, 物理, 情報)</label>
                <input type="text" id="genre" name="genre" class="form-control" required>
              </div>

              <div class="form-group">
                <label>難易度 (1〜5)</label>
                <input type="number" id="difficulty" name="difficulty" class="form-control" min="1" max="5" value="3" required>
              </div>

              <div class="form-group">
                <label>問題文</label>
                <textarea id="question" name="question" class="form-control" rows="3" required></textarea>
              </div>

              <div class="form-group">
                <label>解答</label>
                <input type="text" id="answer" name="answer" class="form-control" required>
              </div>

              <div class="form-group">
                <label>解説 (任意)</label>
                <textarea id="explanation" name="explanation" class="form-control" rows="2"></textarea>
              </div>

              <div class="form-group">
                <label>問題画像URL または 画像アップロード</label>
                <div class="image-input-group">
                  <input type="text" id="image_url" name="image_url" class="form-control" placeholder="https://...">
                  <button type="button" class="btn btn-outline" onclick="openImagePool('image_url')">🖼️ プールから選ぶ</button>
                  <div class="file-input-wrapper">
                    <button type="button" class="btn">📁 参照...</button>
                    <input type="file" id="image_file" name="image_file" accept="image/*" onchange="updateFileName(this, 'image_file_name')">
                  </div>
                </div>
                <div id="image_file_name" style="margin-top:0.5rem; font-size:0.85rem; color:#94a3b8;">選択されていません</div>
              </div>

              <div class="form-group">
                <label>解説画像URL または 画像アップロード</label>
                <div class="image-input-group">
                  <input type="text" id="exp_image_url" name="exp_image_url" class="form-control" placeholder="https://...">
                  <button type="button" class="btn btn-outline" onclick="openImagePool('exp_image_url')">🖼️ プールから選ぶ</button>
                  <div class="file-input-wrapper">
                    <button type="button" class="btn">📁 参照...</button>
                    <input type="file" id="exp_image_file" name="exp_image_file" accept="image/*" onchange="updateFileName(this, 'exp_image_file_name')">
                  </div>
                </div>
                <div id="exp_image_file_name" style="margin-top:0.5rem; font-size:0.85rem; color:#94a3b8;">選択されていません</div>
              </div>

              <button type="submit" class="btn btn-green" style="width:100%; margin-top:1rem; font-size:1.1rem; padding:1rem;" id="submitBtn">登録する</button>
            </form>
          </div>
        </div>

        <!-- 画像プールモーダル -->
        <div id="image-pool-modal" class="modal" style="z-index: 2000;">
          <div class="modal-content" style="max-width: 800px;">
            <div class="modal-header">
              <h2>🖼️ Googleドライブ 画像プール (クイズ用フォルダ)</h2>
              <span class="close" onclick="closeImagePool()">&times;</span>
            </div>
            <p style="color:#94a3b8; font-size:0.9rem; margin-top:0;">※ドライブ内の画像一覧を読み込んでいます...</p>
            <div id="image-pool-grid" class="image-pool-grid">
              <div style="grid-column: 1 / -1; text-align: center; padding: 2rem;"><span class="loader"></span> 読み込み中...</div>
            </div>
          </div>
        </div>

        <!-- ⚙️ 設定モーダル -->
        <div id="settingsModal" class="modal">
          <div class="modal-content">
            <div class="modal-header">
              <h2>⚙️ ゲーム設定</h2>
              <span class="close" onclick="closeSettingsModal()">&times;</span>
            </div>
            <form id="settingsForm">
              <div class="form-group">
                <label>1問の制限時間（秒）</label>
                <input type="number" id="playTime" name="playTime" class="form-control" min="5" max="120" value="${settings.playTime}" required>
              </div>
              <div class="form-group">
                <label>クイズの出題数（通常モード用）</label>
                <input type="number" id="questionCount" name="questionCount" class="form-control" min="1" max="50" value="${settings.questionCount}" required>
              </div>
              <button type="submit" class="btn btn-green" style="width:100%; margin-top:1rem; font-size:1.1rem; padding:1rem;" id="settingsSubmitBtn">設定を保存する</button>
            </form>
          </div>
        </div>

      <script>
        function toggleAll(source) {
          document.querySelectorAll('.rowCheckbox').forEach(cb => cb.checked = source.checked);
        }
        
        function updateFileName(input, targetId) {
          document.getElementById(targetId).textContent = input.files.length > 0 ? input.files[0].name : "選択されていません";
        }

        const modal = document.getElementById('addModal');
        const form = document.getElementById('quizForm');
        
        function openAddModal() {
          document.getElementById('modalTitle').innerText = '新しいクイズを追加';
          form.reset();
          document.getElementById('quizId').value = '';
          document.getElementById('image_file_name').textContent = '選択されていません';
          document.getElementById('exp_image_file_name').textContent = '選択されていません';
          modal.style.display = 'flex';
        }

        function openEditModal(rowData) {
          document.getElementById('modalTitle').innerText = 'クイズを編集 (ID: ' + rowData['ID'] + ')';
          document.getElementById('quizId').value = rowData['ID'];
          document.getElementById('genre').value = rowData['ジャンル'];
          document.getElementById('difficulty').value = rowData['難易度'];
          document.getElementById('question').value = rowData['問題'];
          document.getElementById('answer').value = rowData['解答'];
          document.getElementById('explanation').value = rowData['解説'];
          document.getElementById('image_url').value = rowData['画像URL'];
          document.getElementById('exp_image_url').value = rowData['解説画像URL'];
          document.getElementById('image_file_name').textContent = '選択されていません';
          document.getElementById('exp_image_file_name').textContent = '選択されていません';
          modal.style.display = 'flex';
        }

        function closeAddModal() { modal.style.display = 'none'; }
        
        const settingsModal = document.getElementById('settingsModal');
        function openSettingsModal() { settingsModal.style.display = 'flex'; }
        function closeSettingsModal() { settingsModal.style.display = 'none'; }

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const submitBtn = document.getElementById('submitBtn');
          const originalText = submitBtn.innerText;
          submitBtn.innerHTML = '<span class="loader"></span> 送信中...';
          submitBtn.disabled = true;

          const formData = new FormData(form);
          const isEdit = document.getElementById('quizId').value !== '';
          const endpoint = isEdit ? '/edit-quiz' : '/add-quiz';

          try {
            const response = await fetch(endpoint, { method: 'POST', body: formData });
            const resultHtml = await response.text();
            
            // サーバー側で生成されたHTML（エラー画面等）が返ってきた場合、画面全体を書き換える
            document.open();
            document.write(resultHtml);
            document.close();
          } catch (error) {
            alert('通信エラーが発生しました: ' + error.message);
            submitBtn.innerText = originalText;
            submitBtn.disabled = false;
          }
        });

        document.getElementById('settingsForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const btn = document.getElementById('settingsSubmitBtn');
          btn.innerHTML = '<span class="loader"></span> 保存中...';
          btn.disabled = true;
          
          try {
            await fetch('/update-settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams(new FormData(e.target))
            });
            window.location.reload();
          } catch(e) {
            alert('保存に失敗しました');
            btn.innerHTML = '設定を保存する';
            btn.disabled = false;
          }
        });

        async function deleteSelected() {
          const selected = Array.from(document.querySelectorAll('.rowCheckbox:checked')).map(cb => cb.value);
          if (selected.length === 0) return alert('削除する行を選択してください。');
          if (!confirm(selected.length + '件のクイズを削除しますか？')) return;
          
          try {
            await fetch('/delete-quiz', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: 'ids=' + selected.join(',')
            });
            window.location.reload();
          } catch (e) { alert('削除に失敗しました'); }
        }

        window.onclick = function(event) {
          if (event.target == modal) closeAddModal();
          if (event.target == settingsModal) closeSettingsModal();
          if (event.target == document.getElementById('image-pool-modal')) closeImagePool();
        }

        // 🖼️ 画像プール機能
        let currentPoolTargetId = null;
        function openImagePool(targetId) {
          currentPoolTargetId = targetId;
          document.getElementById('image-pool-modal').style.display = 'flex';
          const grid = document.getElementById('image-pool-grid');
          grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 2rem;"><span class="loader"></span> ドライブから画像を読み込み中...</div>';
          
          fetch('/api/recent-images').then(r => r.json()).then(images => {
            if (images.length === 0) {
              grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #64748b; padding: 2rem;">画像が見つかりません。フォルダの設定などを確認してください。</div>';
              return;
            }
            grid.innerHTML = images.map(url => 
              '<div onclick="selectImageFromPool(\\'' + url + '\\')" class="image-pool-item">' +
              '<div style="height:120px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.05); border-radius:4px; overflow:hidden; margin-bottom:0.5rem;"><img src="' + url + '"></div>' +
              '</div>'
            ).join('');
          }).catch(e => {
            grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #e11d48; padding: 2rem;">読み込みエラー</div>';
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
    `;
    res.send(html);
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
// 🖼️ 画像プール取得API（Googleドライブ直結）
// ==========================================================
app.get('/api/recent-images', async (req, res) => {
  try {
    const response = await axios.post(process.env.GAS_WEB_APP_URL, { action: 'list_images' });
    if (Array.isArray(response.data)) {
      // GAS returns [{name, url, timestamp}], frontend expects array of strings [url, url]
      const urls = response.data.map(img => img.url);
      res.json(urls);
    } else {
      console.error('GAS returned invalid data for list_images:', response.data);
      res.json([]);
    }
  } catch (e) {
    console.error('Failed to fetch image pool from GAS:', e);
    res.json([]);
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
          <h1 style="font-size:3rem; margin-bottom:10px;">⚠️ 保存エラー</h1>
          <p style="font-size:1.2rem;">Googleドライブ側でエラーが発生したため、保存できませんでした。</p>
          <div style="background:rgba(0,0,0,0.2); padding:15px; border-radius:5px; margin:20px 0; font-family:monospace;">${response.data}</div>
          <p>フォルダの設定や権限、またはGASコードに問題がないか確認してください。</p>
          <a href="/" style="display:inline-block; padding:10px 20px; background:#fff; color:#d9534f; text-decoration:none; font-weight:bold; border-radius:5px; margin-top:20px;">ダッシュボードへ戻る</a>
        </div>
      `);
    }

    res.redirect('/');
  } catch (error) {
    console.error('クイズの追加エラー:', error);
    res.send(`
      <div style="background:#d9534f; color:#fff; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif; text-align:center;">
        <h1 style="font-size:3rem; margin-bottom:10px;">⚠️ 通信エラー</h1>
        <p style="font-size:1.2rem;">サーバーとGAS間の通信に失敗しました。</p>
        <p>Error: ${error.message}</p>
        <a href="/" style="display:inline-block; padding:10px 20px; background:#fff; color:#d9534f; text-decoration:none; font-weight:bold; border-radius:5px; margin-top:20px;">ダッシュボードへ戻る</a>
      </div>
    `);
  }
});

// ==========================================================
// 🌟 クイズの編集
// ==========================================================
app.post('/edit-quiz', quizUploadFields, async (req, res) => {
  try {
    const { id, genre, sub_genre, difficulty, question, answer, explanation, image_url, exp_image_url } = req.body;
    let postData = { action: 'edit', id, genre, sub_genre: sub_genre || '', difficulty, question, answer, explanation: explanation || '', image: image_url || '', exp_image: exp_image_url || '' };

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

    const response = await axios.post(process.env.GAS_WEB_APP_URL, postData);
    
    if (typeof response.data === 'string' && response.data.includes('Error')) {
      console.error("❌ GAS側でエラーが発生しました:", response.data);
      return res.send(`
        <div style="background:#d9534f; color:#fff; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif; padding:20px; text-align:center;">
          <h1 style="font-size:3rem; margin-bottom:10px;">⚠️ 保存エラー</h1>
          <p style="font-size:1.2rem;">Googleドライブ側でエラーが発生したため、編集内容を保存できませんでした。</p>
          <div style="background:rgba(0,0,0,0.2); padding:15px; border-radius:5px; margin:20px 0; font-family:monospace;">${response.data}</div>
          <p>フォルダの設定や権限、またはGASコードに問題がないか確認してください。</p>
          <a href="/" style="display:inline-block; padding:10px 20px; background:#fff; color:#d9534f; text-decoration:none; font-weight:bold; border-radius:5px; margin-top:20px;">ダッシュボードへ戻る</a>
        </div>
      `);
    }

    res.redirect('/');
  } catch (error) {
    console.error('クイズの編集エラー:', error);
    res.send(`
      <div style="background:#d9534f; color:#fff; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif; text-align:center;">
        <h1 style="font-size:3rem; margin-bottom:10px;">⚠️ 通信エラー</h1>
        <p style="font-size:1.2rem;">サーバーとGAS間の通信に失敗しました。</p>
        <p>Error: ${error.message}</p>
        <a href="/" style="display:inline-block; padding:10px 20px; background:#fff; color:#d9534f; text-decoration:none; font-weight:bold; border-radius:5px; margin-top:20px;">ダッシュボードへ戻る</a>
      </div>
    `);
  }
});

// ==========================================================
// 🗑️ 複数削除
// ==========================================================
app.post('/delete-quiz', async (req, res) => {
  try {
    const { ids } = req.body;
    await axios.post(process.env.GAS_WEB_APP_URL, { action: 'delete', id: ids });
    res.redirect('/');
  } catch (error) {
    console.error('クイズの削除エラー:', error);
    res.status(500).send('Error deleting quiz');
  }
});

// ==========================================================
// ⚙️ 設定更新
// ==========================================================
app.post('/update-settings', async (req, res) => {
  try {
    const { playTime, questionCount } = req.body;
    await axios.post(process.env.GAS_WEB_APP_URL, { action: 'updateSettings', playTime, questionCount });
    res.redirect('/');
  } catch (error) {
    console.error('設定更新エラー:', error);
    res.status(500).send('Error updating settings');
  }
});

client.login(process.env.DISCORD_TOKEN);
app.listen(PORT, () => {
  console.log(`🚀 Web Dashboard is running on http://localhost:${PORT}`);
});
