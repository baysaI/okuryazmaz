const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../database/db');


if (!process.env.JWT_SECRET) {
    throw new Error('FATAL ERROR: JWT_SECRET environment variable is not defined.');
}
const SECRET_KEY = process.env.JWT_SECRET;

router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !password || !email) return res.status(400).json({ error: 'Kullanıcı adı, e-posta ve şifre zorunludur.' });

    
    const usernameRegex = /^[a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ\s-]{3,20}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!usernameRegex.test(username.trim())) {
        return res.status(400).json({ error: 'Kullanıcı adı 3-20 karakter arasında olmalı ve sadece harf, sayı, boşluk, alt çizgi, tire içermelidir.' });
    }
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Geçersiz e-posta adresi.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Şifre en az 6 karakter olmalıdır.' });
    }
    
    
    const ipAddress = req.ip || req.socket.remoteAddress || '127.0.0.1';

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

            
            const hashedPassword = await bcrypt.hash(password, 10);
            const initial = username.charAt(0).toUpperCase();
            const avatar_url = `https://api.dicebear.com/7.x/initials/svg?seed=${initial}&backgroundColor=2A2826&textColor=D4AF37&bold=true`;

            
            const is_admin = 0;
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

        
        if (user.is_ai) {
            return res.status(403).json({ error: 'Yapay zeka hesapları bu kapıdan giriş yapamaz.' });
        }

        const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, SECRET_KEY, { expiresIn: '24h' });
        res.json({ message: 'Başarıyla giriş yapıldı.', token, user: { id: user.id, username: user.username, avatar_url: user.avatar_url, is_admin: user.is_admin } });
    });
});

module.exports = router;
