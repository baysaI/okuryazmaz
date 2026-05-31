const express = require('express');
const router = express.Router();
const db = require('../database/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const botManager = require('../ai/botManager');


if (!process.env.JWT_SECRET) {
    throw new Error('FATAL ERROR: JWT_SECRET environment variable is not defined.');
}
const SECRET_KEY = process.env.JWT_SECRET;


function requireAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Yetkisiz erişim.' });
    
    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err || !decoded) return res.status(403).json({ error: 'Bu alana sadece kütüphane yöneticileri girebilir.' });
        
        
        db.get('SELECT is_admin, is_banned FROM users WHERE id = ?', [decoded.id], (dbErr, user) => {
            if (dbErr || !user || !user.is_admin || user.is_banned) {
                return res.status(403).json({ error: 'Bu alana sadece kütüphane yöneticileri girebilir.' });
            }
            req.user = { id: decoded.id, username: decoded.username, is_admin: user.is_admin };
            next();
        });
    });
}

router.get('/bots', requireAdmin, (req, res) => {
    db.all('SELECT id, username, email, avatar_url, created_at FROM users WHERE is_ai = 1 ORDER BY id DESC', [], (err, rows) => {
        if (err) {
            console.error('[ADMIN BOTS ERROR]', err);
            return res.status(500).json({ error: 'Bot listesi getirilemedi.' });
        }
        res.json(rows);
    });
});

router.post('/bots', requireAdmin, async (req, res) => {
    const { username, email, avatar_url } = req.body;
    if (!username || !email) return res.status(400).json({ error: 'Kullanıcı adı ve email zorunludur.' });
    
    try {
        
        const randomPassword = crypto.randomUUID();
        const hashedPassword = await bcrypt.hash(randomPassword, 10);
        const finalAvatar = avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${username}&backgroundColor=1A1A1A&textColor=D4AF37&bold=true`;
        
        const stmt = db.prepare('INSERT INTO users (username, email, password, avatar_url, is_ai) VALUES (?, ?, ?, ?, 1)');
        stmt.run([username, email, hashedPassword, finalAvatar], function(err) {
            if (err) {
                console.error('[ADMIN BOTS ADD ERROR]', err);
                return res.status(500).json({ error: 'AI Persona eklenirken veritabanı hatası oluştu.' });
            }
            res.json({ message: 'Yeni AI Persona eklendi.', id: this.lastID });
        });
        stmt.finalize();
    } catch (e) {
        res.status(500).json({ error: 'Kayıt sırasında bir problem yaşandı.' });
    }
});

router.post('/trigger-bot', requireAdmin, (req, res) => {
    try {
        botManager.simulateAIPosting();
        res.json({ message: 'Bot aktivasyonu (Konu açma) başarıyla tetiklendi.' });
    } catch (e) {
        res.status(500).json({ error: 'Tetikleme başarısız oldu.' });
    }
});

router.put('/topics/:id', requireAdmin, (req, res) => {
    const { title, content } = req.body;
    db.get("SELECT content FROM topics WHERE id = ?", [req.params.id], (err, topic) => {
        if (err || !topic) return res.status(404).json({ error: 'Konu bulunamadı.' });

        
        db.run("INSERT INTO edit_history (target_type, target_id, old_content) VALUES (?, ?, ?)",
            ['topic', req.params.id, topic.content]);

        db.run('UPDATE topics SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [title, content, req.params.id], function(err) {
            if (err) {
                console.error('[ADMIN TOPICS EDIT ERROR]', err);
                return res.status(500).json({ error: 'Konu güncellenirken veritabanı hatası oluştu.' });
            }
            res.json({ message: 'Konu başarıyla düzenlendi ve tarihçeye kazındı.' });
        });
    });
});

router.delete('/topics/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM topics WHERE id = ?', [req.params.id], function(err) {
        if (err) {
            console.error('[ADMIN TOPICS DELETE ERROR]', err);
            return res.status(500).json({ error: 'Konu silinirken veritabanı hatası oluştu.' });
        }
        res.json({ message: 'Konu kütüphaneden silindi.' });
    });
});

router.put('/topics/:id/hide', requireAdmin, (req, res) => {
    const { is_hidden } = req.body;
    db.run('UPDATE topics SET is_hidden = ? WHERE id = ?', [is_hidden ? 1 : 0, req.params.id], function(err) {
        if (err) {
            console.error('[ADMIN TOPICS HIDE ERROR]', err);
            return res.status(500).json({ error: 'Konu gizleme/gösterme işlemi başarısız oldu.' });
        }
        res.json({ message: is_hidden ? 'Konu raflardan gizlendi.' : 'Konu tekrar görünür yapıldı.' });
    });
});

router.put('/users/:username/profile', requireAdmin, async (req, res) => {
    let { about_me, avatar_url, email, password, new_username } = req.body;
    
    try {
        let updateQuery = 'UPDATE users SET about_me = ?, avatar_url = ?';
        let params = [about_me, avatar_url];
        
        if (email) {
            updateQuery += ', email = ?';
            params.push(email);
        }
        if (new_username) {
            updateQuery += ', username = ?';
            params.push(new_username);
        }
        if (password && password.trim() !== '') {
            const hashedPassword = await bcrypt.hash(password, 10);
            updateQuery += ', password = ?';
            params.push(hashedPassword);
        }
        
        updateQuery += ' WHERE username = ?';
        params.push(req.params.username);
        
        db.run(updateQuery, params, function(err) {
            if (err) {
                console.error('[ADMIN PROFILE EDIT ERROR]', err);
                return res.status(500).json({ error: 'Kullanıcı profili güncellenirken hata oluştu.' });
            }
            res.json({ message: 'Kullanıcı kaydı admin yetkisiyle başarıyla mühürlendi.', new_username: new_username || req.params.username });
        });
    } catch(e) {
        res.status(500).json({ error: 'Kayıt güncellenemedi.' });
    }
});

router.delete('/posts/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM posts WHERE id = ?', [req.params.id], function(err) {
        if (err) {
            console.error('[ADMIN POST DELETE ERROR]', err);
            return res.status(500).json({ error: 'Yorum silinirken veritabanı hatası oluştu.' });
        }
        res.json({ message: 'İleti kütüphaneden silindi.' });
    });
});

router.get('/users', requireAdmin, (req, res) => {
    db.all('SELECT id, username, email, avatar_url, created_at, is_ai FROM users ORDER BY created_at DESC', [], (err, rows) => {
        if (err) {
            console.error('[ADMIN USERS LIST ERROR]', err);
            return res.status(500).json({ error: 'Yazar listesi getirilemedi.' });
        }
        res.json(rows);
    });
});

router.get('/reports', requireAdmin, (req, res) => {
    db.all(`SELECT r.*, u.username as reporter_name 
            FROM reports r 
            LEFT JOIN users u ON r.reporter_id = u.id 
            ORDER BY r.created_at DESC`, [], (err, rows) => {
        if (err) {
            console.error('[ADMIN REPORTS LIST ERROR]', err);
            return res.status(500).json({ error: 'Şikayet listesi listelenemedi.' });
        }
        res.json(rows);
    });
});

router.put('/reports/:id/resolve', requireAdmin, (req, res) => {
    db.get("SELECT reporter_id, target_type, target_id FROM reports WHERE id = ?", [req.params.id], (err, report) => {
        if (err || !report) return res.status(404).json({ error: 'Rapor bulunamadı.' });

        db.run("UPDATE reports SET status = 'resolved' WHERE id = ?", [req.params.id], (err) => {
            if (err) {
                console.error('[ADMIN REPORTS RESOLVE ERROR]', err);
                return res.status(500).json({ error: 'Rapor çözümlenirken veritabanı hatası oluştu.' });
            }

            db.run("INSERT INTO notifications (user_id, sender_id, type, source_id, message) VALUES (?, ?, ?, ?, ?)",
                [report.reporter_id, req.user.id, 'report_update', req.params.id, `Şikayetiniz kütüphane yönetimi tarafından incelendi ve çözüldü.`]);

            res.json({ message: 'Rapor çözüldü ve şikayetçi bilgilendirildi.' });
        });
    });
});

router.put('/posts/:id', requireAdmin, (req, res) => {
    const { content } = req.body;
    db.get("SELECT content FROM posts WHERE id = ?", [req.params.id], (err, post) => {
        if (err || !post) return res.status(404).json({ error: 'İleti bulunamadı.' });

        db.run("INSERT INTO edit_history (target_type, target_id, old_content) VALUES (?, ?, ?)",
            ['post', req.params.id, post.content]);

        db.run("UPDATE posts SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [content, req.params.id], function(err) {
                if (err) {
                    console.error('[ADMIN POSTS EDIT ERROR]', err);
                    return res.status(500).json({ error: 'Yorum güncellenirken veritabanı hatası oluştu.' });
                }
                res.json({ message: 'İleti yönetici tarafından düzenlendi.' });
            });
    });
});

router.get('/posts/:id/history', requireAdmin, (req, res) => {
    db.all("SELECT * FROM edit_history WHERE target_type = 'post' AND target_id = ? ORDER BY edited_at DESC", [req.params.id], (err, rows) => {
        if (err) {
            console.error('[ADMIN POST HISTORY ERROR]', err);
            return res.status(500).json({ error: 'Yorum geçmişi getirilemedi.' });
        }
        res.json(rows);
    });
});


router.get('/bot-activity', requireAdmin, (req, res) => {
    const query = `
        SELECT * FROM (
            SELECT 'post' as activity_type, posts.id, posts.content, posts.created_at AS created_at, 
                   users.username, users.avatar_url,
                   topics.title as topic_title, topics.id as topic_id
            FROM posts 
            INNER JOIN users ON posts.user_id = users.id
            INNER JOIN topics ON posts.topic_id = topics.id
            WHERE users.is_ai = 1
            UNION ALL
            SELECT 'topic' as activity_type, topics.id, topics.content, topics.created_at AS created_at,
                   users.username, users.avatar_url,
                   topics.title as topic_title, topics.id as topic_id
            FROM topics
            INNER JOIN users ON topics.user_id = users.id
            WHERE users.is_ai = 1
        )
        ORDER BY created_at DESC
        LIMIT 30
    `;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('[ADMIN BOT ACTIVITY ERROR]', err);
            return res.status(500).json({ error: 'Bot aktivite geçmişi listelenemedi.' });
        }
        res.json(rows);
    });
});

module.exports = router;
