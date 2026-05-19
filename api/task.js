
const crypto = require('crypto');

const API_KEY = process.env.API_KEY || 'rimuru-task-2026';
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || '';

// インメモリストレージ（Vercel再起動でリセット）
// 本番はUpstash Redis推奨
let tasks = [];

function auth(req, res) {
    const key = req.headers['x-api-key'];
    if (key !== API_KEY) {
        res.status(401).json({ error: 'Unauthorized' });
        return false;
    }
    return true;
}

async function notifyDiscord(msg) {
    if (!DISCORD_WEBHOOK) return;
    try {
        const body = JSON.stringify({ content: msg });
        const url = new URL(DISCORD_WEBHOOK);
        const https = require('https');
        await new Promise((resolve) => {
            const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, resolve);
            req.write(body); req.end();
        });
    } catch(e) {}
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-API-Key');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (!auth(req, res)) return;

    const urlParts = req.url.split('/').filter(Boolean);
    // urlParts: ['api','task'] or ['api','task','ID'] or ['api','task','ID','log']
    const taskId = urlParts[2] || null;
    const subAction = urlParts[3] || null;

    // GET /api/task/status - ダッシュボード
    if (req.method === 'GET' && taskId === 'status') {
        const now = Date.now();
        return res.json({
            total: tasks.length,
            pending: tasks.filter(t => t.status === 'pending').length,
            in_progress: tasks.filter(t => t.status === 'in_progress').length,
            done: tasks.filter(t => t.status === 'done').length,
            failed: tasks.filter(t => t.status === 'failed').length,
            expired: tasks.filter(t => t.status === 'expired').length,
            recent_completed: tasks.filter(t => t.status === 'done').slice(-5).map(t => ({
                id: t.id, title: t.title, completed_at: t.updated_at
            })),
            timestamp: new Date().toISOString()
        });
    }

    // GET /api/task/:id/log
    if (req.method === 'GET' && taskId && subAction === 'log') {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return res.status(404).json({ error: 'Not found' });
        return res.json({ id: taskId, title: task.title, logs: task.logs || [] });
    }

    // POST /api/task/:id/log - ログ追記
    if (req.method === 'POST' && taskId && subAction === 'log') {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return res.status(404).json({ error: 'Not found' });
        const { message, level } = req.body || {};
        if (!message) return res.status(400).json({ error: 'message required' });
        const entry = { timestamp: new Date().toISOString(), level: level || 'info', message };
        task.logs = task.logs || [];
        task.logs.push(entry);
        task.updated_at = new Date().toISOString();
        if (DISCORD_WEBHOOK) await notifyDiscord(`📋 [${task.title}] ${message}`);
        return res.json({ ok: true, entry });
    }

    // GET /api/task - 一覧
    if (req.method === 'GET' && !taskId) {
        // 期限切れ処理
        const now = Date.now();
        tasks.forEach(t => {
            if (t.status === 'pending' && t.expires_at && new Date(t.expires_at).getTime() < now) {
                t.status = 'expired';
            }
        });
        const status = req.url.includes('status=') 
            ? new URLSearchParams(req.url.split('?')[1]).get('status')
            : null;
        const result = status ? tasks.filter(t => t.status === status) : tasks.filter(t => t.status === 'pending');
        return res.json(result);
    }

    // POST /api/task - 新規タスク
    if (req.method === 'POST' && !taskId) {
        const { title, description, priority, expires_in_hours } = req.body || {};
        if (!title) return res.status(400).json({ error: 'title required' });
        // 重複チェック
        const dup = tasks.find(t => t.title === title && t.status === 'pending');
        if (dup) return res.status(409).json({ error: 'Duplicate task', existing: dup });
        const now = new Date();
        const task = {
            id: crypto.randomUUID(),
            title,
            description: description || '',
            priority: priority || 'medium',
            status: 'pending',
            logs: [],
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
            expires_at: expires_in_hours 
                ? new Date(now.getTime() + expires_in_hours * 3600000).toISOString()
                : new Date(now.getTime() + 86400000).toISOString() // デフォルト24h
        };
        tasks.push(task);
        if (DISCORD_WEBHOOK) await notifyDiscord(`📥 新タスク[${task.priority}]: ${title}`);
        return res.status(201).json(task);
    }

    // PATCH /api/task/:id - ステータス更新
    if (req.method === 'PATCH' && taskId && !subAction) {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return res.status(404).json({ error: 'Not found' });
        const { status, result_url } = req.body || {};
        if (status) task.status = status;
        if (result_url) task.result_url = result_url;
        task.updated_at = new Date().toISOString();
        if (status === 'done') {
            task.completed_at = task.updated_at;
            if (DISCORD_WEBHOOK) await notifyDiscord(`✅ 完了: ${task.title}${result_url ? '\n' + result_url : ''}`);
        }
        if (status === 'failed') {
            if (DISCORD_WEBHOOK) await notifyDiscord(`❌ 失敗: ${task.title}`);
        }
        return res.json(task);
    }

    // DELETE /api/task/:id
    if (req.method === 'DELETE' && taskId) {
        const idx = tasks.findIndex(t => t.id === taskId);
        if (idx === -1) return res.status(404).json({ error: 'Not found' });
        tasks.splice(idx, 1);
        return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
