const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../database/db');

const SECRET_KEY = process.env.JWT_SECRET || 'okuryazmaz_super_secret_dev_key';

router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !password || !email) return res.status(400).json({ error: 'Kullanıcı adı, e-posta ve şifre zorunludur.' });

    // Ensure username does not contain spaces if we want, but the prompt didn't say that.
    
    // Get IP address
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;

    try {
        db.get('SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR email = ? OR ip_address = ?', [username, email, ipAddress], async (err, row) => {
            if (err) return res.status(500).json({ error: 'Veritabanı hatası.' });

            if (row) {
                if (row.username.toLowerCase() === username.toLowerCase()) {
                    return res.status(400).json({ error: 'Bu isimde bir yazar zaten kütüphanemizde bulunuyor.' });
                }
                if (row.email === email) {
                    return res.status(400).json({ error: 'Bu e-posta adresi ile zaten kayıt olunmuş.' });
                }
                if (row.ip_address === ipAddress) {
                    if (row.is_banned) {
                        return res.status(403).json({ error: 'Yasaklandığınız için yeni hesap açamazsınız.' });
                    } else {
                        return res.status(403).json({ error: 'Zaten bir hesabınız bulunuyor. Birden fazla hesap açamazsınız.' });
                    }
                }
            }

            // No conflicts found, proceed with creation
            const hashedPassword = await bcrypt.hash(password, 10);
            const initial = username.charAt(0).toUpperCase();
            const avatar_url = `https://api.dicebear.com/7.x/initials/svg?seed=${initial}&backgroundColor=2A2826&textColor=D4AF37&bold=true`;

            const is_admin = username.toLowerCase() === 'mehmet' ? 1 : 0;
            const insertStmt = db.prepare('INSERT INTO users (username, email, password, avatar_url, is_admin, ip_address) VALUES (?, ?, ?, ?, ?, ?)');
            
            insertStmt.run([username, email, hashedPassword, avatar_url, is_admin, ipAddress], function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Kayıt sırasında bir problem yaşandı.' });
                }
                res.status(201).json({ message: 'Edebiyat Kulübüne hoş geldiniz!', userId: this.lastID });
            });
            insertStmt.finalize();
        });
    } catch (error) {
        res.status(500).json({ error: 'Sunucu hatası.' });
    }
});

router.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) return res.status(500).json({ error: 'Veritabanı hatası.' });
        if (!user) return res.status(400).json({ error: 'Böyle bir kullanıcı bulunamadı.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'Kelime oyununu yanlış oynadınız, şifre hatalı.' });

        if (user.is_banned) {
            return res.status(403).json({ error: `Hesabınız yasaklandı. Sebep: ${user.ban_reason || 'Belirtilmemiş'}` });
        }

        if (user.username.toLowerCase() === 'mehmet' && !user.is_admin) {
            db.run('UPDATE users SET is_admin = 1 WHERE id = ?', [user.id]);
            user.is_admin = 1;
        }

        const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, SECRET_KEY, { expiresIn: '24h' });
        res.json({ message: 'Başarıyla giriş yapıldı.', token, user: { id: user.id, username: user.username, avatar_url: user.avatar_url, is_admin: user.is_admin } });
    });
});

module.exports = router;
