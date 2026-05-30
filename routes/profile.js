const express = require('express');
const router = express.Router();
const db = require('../database/db');
const jwt = require('jsonwebtoken');
const { adminGrantBadge, adminRevokeBadge, checkAndAwardBadges } = require('../utils/badges');

const SECRET_KEY = process.env.JWT_SECRET || 'okuryazmaz_super_secret_dev_key';

function authenticate(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, SECRET_KEY, (err, user) => {
            if (!err) req.user = user;
            next();
        });
    } else {
        next();
    }
}

// Tüm rozet tanımları (Bu route /:username'den ÖNCE olmalı)
router.get('/badges/all', (req, res) => {
    db.all('SELECT * FROM badges ORDER BY category, id', [], (err, badges) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(badges || []);
    });
});

// Profil Görüntüleme
router.get('/:username', authenticate, (req, res) => {
    const { username } = req.params;
    db.get('SELECT id, username, avatar_url, about_me, created_at, is_banned, is_muted FROM users WHERE username = ?', [username], (err, profileUser) => {
        if (err || !profileUser) return res.status(404).json({ error: 'Bu yazar henüz okuryazmaz platformuna uğramamış.' });

        db.all('SELECT * FROM topics WHERE user_id = ? ORDER BY created_at DESC', [profileUser.id], (err, topics) => {
            db.all('SELECT u.username, u.avatar_url FROM followers f JOIN users u ON f.follower_id = u.id WHERE f.following_id = ?', [profileUser.id], (err, followersList) => {
                let isFollowing = false;
                const followersCount = followersList ? followersList.length : 0;

                // Favori kitaplar
                db.all('SELECT * FROM user_favorite_books WHERE user_id = ? ORDER BY added_at DESC', [profileUser.id], (err, favBooks) => {
                    // Favori yazarlar
                    db.all('SELECT * FROM user_favorite_authors WHERE user_id = ? ORDER BY added_at DESC', [profileUser.id], (err, favAuthors) => {
                        // Rozetler
                        db.all(`SELECT b.code, b.name, b.description, b.icon, b.color, b.category, ub.earned_at 
                                FROM user_badges ub JOIN badges b ON ub.badge_id = b.id 
                                WHERE ub.user_id = ? ORDER BY ub.earned_at DESC`, [profileUser.id], (err, badges) => {

                            const sendResponse = (isFollowing) => {
                                res.json({
                                    user: profileUser,
                                    topics,
                                    followers: followersCount,
                                    isFollowing,
                                    followersList,
                                    favoriteBooks: favBooks || [],
                                    favoriteAuthors: favAuthors || [],
                                    badges: badges || []
                                });
                            };

                            if (req.user) {
                                db.get('SELECT * FROM followers WHERE follower_id = ? AND following_id = ?', [req.user.id, profileUser.id], (err, row) => {
                                    sendResponse(!!row);
                                });
                            } else {
                                sendResponse(false);
                            }
                        });
                    });
                });
            });
        });
    });
});

// Hakkımda Düzenle
router.put('/edit', authenticate, (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Önce giriş yapın.' });
    const { about_me, avatar_url } = req.body;
    db.run('UPDATE users SET about_me = ?, avatar_url = ? WHERE id = ?', [about_me, avatar_url, req.user.id], function (err) {
        if (err) return res.status(500).json({ error: 'Güncellenirken hata oluştu.' });
        res.json({ message: 'Biyografiniz başarıyla mühürlendi.' });
    });
});

// ===== FAVORİ KİTAP =====
router.post('/favorites/book', authenticate, (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Giriş yapın.' });
    const { book_title, book_author, book_cover_url, book_key } = req.body;
    if (!book_title) return res.status(400).json({ error: 'Kitap adı gerekli.' });

    db.get('SELECT count(*) as c FROM user_favorite_books WHERE user_id = ?', [req.user.id], (err, r) => {
        if (r && r.c >= 3) return res.status(400).json({ error: 'En fazla 3 favori kitap ekleyebilirsiniz.' });
        db.run('INSERT INTO user_favorite_books (user_id, book_title, book_author, book_cover_url, book_key) VALUES (?, ?, ?, ?, ?)',
            [req.user.id, book_title, book_author, book_cover_url, book_key], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                checkAndAwardBadges(req.user.id);
                res.json({ id: this.lastID, message: 'Favori kitap eklendi.' });
            });
    });
});

router.delete('/favorites/book/:id', authenticate, (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Giriş yapın.' });
    db.run('DELETE FROM user_favorite_books WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Favori kitap silindi.' });
    });
});

// ===== FAVORİ YAZAR =====
router.post('/favorites/author', authenticate, (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Giriş yapın.' });
    const { author_name, author_photo_url, author_key } = req.body;
    if (!author_name) return res.status(400).json({ error: 'Yazar adı gerekli.' });

    db.get('SELECT count(*) as c FROM user_favorite_authors WHERE user_id = ?', [req.user.id], (err, r) => {
        if (r && r.c >= 3) return res.status(400).json({ error: 'En fazla 3 favori yazar ekleyebilirsiniz.' });
        db.run('INSERT INTO user_favorite_authors (user_id, author_name, author_photo_url, author_key) VALUES (?, ?, ?, ?)',
            [req.user.id, author_name, author_photo_url, author_key], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                checkAndAwardBadges(req.user.id);
                res.json({ id: this.lastID, message: 'Favori yazar eklendi.' });
            });
    });
});

router.delete('/favorites/author/:id', authenticate, (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Giriş yapın.' });
    db.run('DELETE FROM user_favorite_authors WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Favori yazar silindi.' });
    });
});

// Takip Et / Bırak (Toggle)
router.post('/:id/follow', authenticate, (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Takip etmek için önce edebiyat kulübüne katılmalısınız.' });
    const following_id = req.params.id;
    const follower_id = req.user.id;

    if (following_id == follower_id) return res.status(400).json({ error: 'Ayna karşısında kendinizi izleyemezsiniz.' });

    db.get('SELECT * FROM followers WHERE follower_id = ? AND following_id = ?', [follower_id, following_id], (err, existing) => {
        if (existing) {
            db.run('DELETE FROM followers WHERE follower_id = ? AND following_id = ?', [follower_id, following_id], () => res.json({ status: 'unfollowed' }));
        } else {
            db.run('INSERT INTO followers (follower_id, following_id) VALUES (?, ?)', [follower_id, following_id], function (err) {
                if (err) return res.status(500).json({ error: 'Takip edilemedi.' });
                
                checkAndAwardBadges(following_id);
                
                const msg = `👤 ${req.user.username} seni takip etmeye başladı. Belki sen de onu geri takip etmek istersin!`;
                db.run('INSERT INTO notifications (user_id, sender_id, type, message) VALUES (?, ?, ?, ?)', [following_id, follower_id, 'follow', msg], () => {
                    res.json({ status: 'followed' });
                });
            });
        }
    });
});

// ===== ADMİN: ROZET YÖNETİMİ =====
router.post('/admin/badge/grant', authenticate, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Giriş yapın.' });
    db.get('SELECT is_admin FROM users WHERE id = ?', [req.user.id], async (err, u) => {
        if (!u || !u.is_admin) return res.status(403).json({ error: 'Yetkisiz.' });
        console.log('[BADGE DEBUG] Grant request - user_id:', req.body.user_id, 'badge_code:', req.body.badge_code);
        try {
            const result = await adminGrantBadge(req.body.user_id, req.body.badge_code);
            console.log('[BADGE DEBUG] Grant result:', result.message);
            res.json(result);
        } catch(e) { res.status(400).json({ error: e.message }); }
    });
});

router.post('/admin/badge/revoke', authenticate, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Giriş yapın.' });
    db.get('SELECT is_admin FROM users WHERE id = ?', [req.user.id], async (err, u) => {
        if (!u || !u.is_admin) return res.status(403).json({ error: 'Yetkisiz.' });
        try {
            const result = await adminRevokeBadge(req.body.user_id, req.body.badge_code);
            res.json(result);
        } catch(e) { res.status(400).json({ error: e.message }); }
    });
});

// ===== ADMİN: KULLANICI YÖNETİMİ =====

// Yasakla (Ban)
router.post('/admin/ban', authenticate, (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Giriş yapın.' });
    db.get('SELECT is_admin FROM users WHERE id = ?', [req.user.id], (err, admin) => {
        if (!admin || !admin.is_admin) return res.status(403).json({ error: 'Yetkisiz.' });
        const { user_id, reason } = req.body;
        if (user_id === req.user.id) return res.status(400).json({ error: 'Kendinizi yasaklayamazsınız.' });
        db.get('SELECT is_admin FROM users WHERE id = ?', [user_id], (err, target) => {
            if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
            if (target.is_admin) return res.status(400).json({ error: 'Başka bir yöneticiyi yasaklayamazsınız.' });
            db.run('UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?', [reason || 'Belirtilmemiş', user_id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Kullanıcı yasaklandı.' });
            });
        });
    });
});

// Yasak Kaldır (Unban)
router.post('/admin/unban', authenticate, (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Giriş yapın.' });
    db.get('SELECT is_admin FROM users WHERE id = ?', [req.user.id], (err, admin) => {
        if (!admin || !admin.is_admin) return res.status(403).json({ error: 'Yetkisiz.' });
        db.run('UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?', [req.body.user_id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Kullanıcının yasağı kaldırıldı.' });
        });
    });
});

// Sustur (Mute) — süre dakika cinsinden
router.post('/admin/mute', authenticate, (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Giriş yapın.' });
    db.get('SELECT is_admin FROM users WHERE id = ?', [req.user.id], (err, admin) => {
        if (!admin || !admin.is_admin) return res.status(403).json({ error: 'Yetkisiz.' });
        const { user_id, duration_minutes } = req.body;
        if (user_id === req.user.id) return res.status(400).json({ error: 'Kendinizi susturamazsınız.' });
        const minutes = parseInt(duration_minutes) || 60;
        const mutedUntil = new Date(Date.now() + minutes * 60000).toISOString();
        db.run('UPDATE users SET is_muted = 1, muted_until = ? WHERE id = ?', [mutedUntil, user_id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: `Kullanıcı ${minutes} dakika susturuldu.` });
        });
    });
});

// Susturmayı Kaldır (Unmute)
router.post('/admin/unmute', authenticate, (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Giriş yapın.' });
    db.get('SELECT is_admin FROM users WHERE id = ?', [req.user.id], (err, admin) => {
        if (!admin || !admin.is_admin) return res.status(403).json({ error: 'Yetkisiz.' });
        db.run('UPDATE users SET is_muted = 0, muted_until = NULL WHERE id = ?', [req.body.user_id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Kullanıcının susturması kaldırıldı.' });
        });
    });
});

// Hesap Sil (Delete)
router.post('/admin/delete-user', authenticate, (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Giriş yapın.' });
    db.get('SELECT is_admin FROM users WHERE id = ?', [req.user.id], (err, admin) => {
        if (!admin || !admin.is_admin) return res.status(403).json({ error: 'Yetkisiz.' });
        const { user_id } = req.body;
        if (user_id === req.user.id) return res.status(400).json({ error: 'Kendi hesabınızı silemezsiniz.' });
        db.get('SELECT is_admin, username FROM users WHERE id = ?', [user_id], (err, target) => {
            if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
            if (target.is_admin) return res.status(400).json({ error: 'Başka bir yöneticiyi silemezsiniz.' });
            // Tüm ilişkili verileri sil
            db.serialize(() => {
                db.run('DELETE FROM posts WHERE user_id = ?', [user_id]);
                db.run('DELETE FROM topics WHERE user_id = ?', [user_id]);
                db.run('DELETE FROM followers WHERE follower_id = ? OR following_id = ?', [user_id, user_id]);
                db.run('DELETE FROM notifications WHERE user_id = ?', [user_id]);
                db.run('DELETE FROM user_badges WHERE user_id = ?', [user_id]);
                db.run('DELETE FROM user_favorite_books WHERE user_id = ?', [user_id]);
                db.run('DELETE FROM user_favorite_authors WHERE user_id = ?', [user_id]);
                db.run('DELETE FROM users WHERE id = ?', [user_id], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: `${target.username} hesabı ve tüm verileri silindi.` });
                });
            });
        });
    });
});

module.exports = router;
