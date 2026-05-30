const express = require('express');
const router = express.Router();
const db = require('../database/db');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const botManager = require('../ai/botManager');

const SECRET_KEY = process.env.JWT_SECRET || 'okuryazmaz_super_secret_dev_key';

function requireAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Cevap verebilmek için kimliğinizi kanıtlamanız gerekmekte (Giriş yapın).' });
    
    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: 'Oturumunuz süresi dolmuş veya geçersiz.' });
        req.user = user;
        next();
    });
}

// Yazma aksiyonları için ban/mute kontrolü
function requireWriteAccess(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Giriş yapın.' });
    db.get('SELECT is_banned, ban_reason, is_muted, muted_until FROM users WHERE id = ?', [req.user.id], (err, user) => {
        if (err || !user) return res.status(500).json({ error: 'Kullanıcı doğrulanamadı.' });
        if (user.is_banned) return res.status(403).json({ error: `Hesabınız yasaklanmış. Sebep: ${user.ban_reason || 'Belirtilmemiş'}` });
        if (user.is_muted) {
            if (user.muted_until && new Date(user.muted_until) > new Date()) {
                const kalan = Math.ceil((new Date(user.muted_until) - new Date()) / 60000);
                return res.status(403).json({ error: `Susturuldunuz. Kalan süre: ${kalan} dakika.` });
            } else {
                // Süre dolmuş, otomatik kaldır
                db.run('UPDATE users SET is_muted = 0, muted_until = NULL WHERE id = ?', [req.user.id]);
            }
        }
        next();
    });
}

function optionalAuth(req, res, next) {
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

// Basit view rate-limit (IP/user başına konu başına 1 dakikada max 1 artış)
const viewCooldowns = new Map();
function canIncrementView(topicId, identifier) {
    const key = `${topicId}:${identifier}`;
    const now = Date.now();
    const last = viewCooldowns.get(key);
    if (last && now - last < 60000) return false;
    viewCooldowns.set(key, now);
    // Bellek temizliği: 10k girişi aşarsa eski entry'leri temizle
    if (viewCooldowns.size > 10000) {
        for (const [k, v] of viewCooldowns) {
            if (now - v > 120000) viewCooldowns.delete(k);
        }
    }
    return true;
}

router.get('/categories', (req, res) => {
    db.all('SELECT * FROM categories', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

router.get('/random-books', (req, res) => {
    const pool = req.app.locals.cachedPopularBooks || [];
    if (pool.length === 0) return res.json([]);
    
    // Ana sayfada yüksek kaliteli, kapaklı ve prestijli kitapların görünmesi için filtreleme yapıyoruz.
    // (Böylece SEO için arka planda duran devasa sitemap arşivi bozulmaz, fakat ana sayfada sadece en seçkin eserler listelenir)
    const filteredPool = pool.filter(b => {
        // 1. Mutlaka kapak resmi olmalı (Uçsuz bucaksız boş kapak ikonlarını yok eder)
        if (!b.cover_i) return false;
        
        // 2. Başlık sadece Latin/Türkçe alfabe karakterleri içermeli (Rusça, Korece, Yunanca alakasız çevirileri eler)
        const isLatin = /^[A-Za-z0-9\s.,'’\"!\?\-\(\):;üÜöÖıİğĞşŞçÇâÂîÎûÛ]+$/.test(b.title);
        if (!isLatin) return false;
        
        // 3. Çok kısa, anlamsız veya mevzuat/bülten gibi veri çöplerini eler
        if (b.title.trim().length < 3) return false;
        if (/^\d+$/.test(b.title)) return false; 
        if (/bulletin|teblig|dergi|kanun|yönetmelik|mevzuat|gazete/i.test(b.title)) return false;
        
        // 4. Bilinmeyen veya eksik yazarlı kitapları eler
        if (!b.author_name || b.author_name === 'Bilinmeyen Yazar') return false;
        
        // 5. Sadece Türk ve Dünya edebiyatının en seçkin, popüler ve bilinen yazarlarını hedefler
        const popularAuthors = [
            'Sabahattin Ali', 'Orhan Pamuk', 'Oğuz Atay', 'Yaşar Kemal', 'Ahmet Hamdi Tanpınar',
            'Fyodor Dostoevsky', 'Franz Kafka', 'Lev Tolstoy', 'George Orwell', 'Stefan Zweig',
            'Zülfü Livaneli', 'Halid Ziya Uşaklıgil', 'Peyami Safa', 'Reşat Nuri Güntekin',
            'Victor Hugo', 'Albert Camus', 'Jean-Paul Sartre', 'Jane Austen', 'Virginia Woolf',
            'J. K. Rowling', 'J.R.R. Tolkien', 'Antoine de Saint-Exupéry', 'Gabriel García Márquez',
            'Agatha Christie', 'Stephen King', 'Dan Brown', 'Jules Verne', 'Aldous Huxley',
            'George R. R. Martin', 'Stephen Hawking', 'Yuval Noah Harari', 'Haruki Murakami',
            'Ursula K. Le Guin', 'John Steinbeck', 'Charles Dickens', 'Arthur Conan Doyle',
            'William Shakespeare', 'Isaac Asimov', 'Friedrich Nietzsche', 'Sigmund Freud',
            'Oscar Wilde', 'Herman Melville', 'Edgar Allan Poe', 'Paulo Coelho', 'Mark Twain',
            'Ernest Hemingway', 'J.K. Rowling', 'Leo Tolstoy'
        ];
        
        const isPopularAuthor = popularAuthors.some(author => 
            b.author_name.toLowerCase().includes(author.toLowerCase())
        );
        
        return isPopularAuthor;
    });
    
    // Güvenlik Duvarı (Fallback): Eğer filtreleme çok agresif olursa ve havuzda 12'den az kitap kalırsa kapaklı olanlardan devam et
    const finalPool = filteredPool.length >= 12 ? filteredPool : pool.filter(b => b.cover_i);
    
    // Rastgele 12 kitap seç
    const shuffled = [...finalPool].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, 12);
    
    // Arayüzün beklediği formata dönüştür
    const formatted = selected.map(b => ({
        key: '/works/' + b.key,
        title: b.title,
        cover_id: b.cover_i,
        authors: [{ name: b.author_name }]
    }));
    
    res.json(formatted);
});

router.get('/categories/:id/topics', optionalAuth, (req, res) => {
    const catId = req.params.id;
    let query = `SELECT topics.*, users.username, users.avatar_url,
                 (SELECT COUNT(*) FROM posts WHERE posts.topic_id = topics.id) as reply_count
                 FROM topics LEFT JOIN users ON topics.user_id = users.id 
                 WHERE category_id = ? AND IFNULL(is_hidden, 0) = 0 ORDER BY created_at DESC`;
    
    if (req.user && req.user.is_admin) {
        query = `SELECT topics.*, users.username, users.avatar_url,
                 (SELECT COUNT(*) FROM posts WHERE posts.topic_id = topics.id) as reply_count
                 FROM topics LEFT JOIN users ON topics.user_id = users.id 
                 WHERE category_id = ? ORDER BY created_at DESC`;
    }

    db.all(query, [catId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

router.post('/topics', requireAuth, requireWriteAccess, async (req, res) => {
    const { category_id, title, content, book_query, as_username } = req.body;
    let user_id = req.user.id;
    
    if (!category_id || !title || !content) return res.status(400).json({ error: 'Başlık ve içerik alanları zorunludur.' });

    let coverUrl = null, author = null, pages = null, releaseDate = null, bookTitle = book_query || null, bookKey = null;

    if (book_query && book_query.trim().length > 2) {
        try {
            const searchRes = await axios.get(`https://openlibrary.org/search.json?title=${encodeURIComponent(book_query)}&limit=5`);
            if(searchRes.data.docs && searchRes.data.docs.length > 0) {
                const targetBook = searchRes.data.docs.find(item => item.cover_i) || searchRes.data.docs[0];
                const book = targetBook;
                bookTitle = book.title;
                bookKey = book.key;
                coverUrl = book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg` : null;
                author = book.author_name ? book.author_name.join(', ') : 'Bilinmiyor';
                pages = book.number_of_pages_median || '-';
                releaseDate = book.first_publish_year || '-';
            }
        } catch(e) { console.error('Books API çekilirken sorun oldu.'); }
    }

    if (req.user.is_admin && as_username && as_username.trim() !== '') {
        const username = as_username.trim();
        db.get("SELECT id FROM users WHERE username = ?", [username], async (err, row) => {
            if (row) {
                user_id = row.id;
                insertTopic();
            } else {
                const bcrypt = require('bcrypt');
                const hashedPassword = await bcrypt.hash(require('crypto').randomBytes(24).toString('hex'), 10);
                const avatar = `https://api.dicebear.com/7.x/initials/svg?seed=${username}&backgroundColor=1A1A1A&textColor=D4AF37&bold=true`;
                const email = username.toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(Math.random()*1000) + '@okuryazmaz.com';
                
                db.run('INSERT INTO users (username, email, password, avatar_url, is_ai) VALUES (?, ?, ?, ?, 1)', 
                    [username, email, hashedPassword, avatar], function(err) {
                        if (err) return res.status(500).json({ error: err.message });
                        user_id = this.lastID;
                        insertTopic();
                });
            }
        });
    } else {
        insertTopic();
    }

    function insertTopic() {
        const stmt = db.prepare('INSERT INTO topics (category_id, user_id, title, content, book_reference_title, book_cover_url, book_author, book_pages, book_publish_date, book_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        stmt.run([category_id, user_id, title, content, bookTitle, coverUrl, author, pages, releaseDate, bookKey], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ message: 'Konunuz başarıyla sayfalar arası yerini aldı.', topicId: this.lastID });
        });
        stmt.finalize();
    }
});

router.get('/topics/:id', optionalAuth, (req, res) => {
    const topicId = req.params.id;
    
    // View'u yalnızca gerçek benzersiz ziyaretlerde artır (1 dk cooldown)
    const identifier = req.user?.id || req.ip || req.headers['x-forwarded-for'] || 'anon';
    if (canIncrementView(topicId, identifier)) {
        db.run('UPDATE topics SET views = views + 1 WHERE id = ?', [topicId]);
    }

    db.get('SELECT topics.*, users.username, users.avatar_url FROM topics LEFT JOIN users ON topics.user_id = users.id WHERE topics.id = ?', [topicId], (err, topic) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!topic) return res.status(404).json({ error: 'Aradığınız konu rüzgarda kaybolmuş.' });
        if (topic.is_hidden && (!req.user || !req.user.is_admin)) return res.status(403).json({ error: 'Bu konu kütüphane yöneticileri tarafından kaldırılmış.' });

        db.all('SELECT posts.*, users.username, users.avatar_url FROM posts LEFT JOIN users ON posts.user_id = users.id WHERE topic_id = ? ORDER BY created_at ASC', [topicId], (err, posts) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ topic, posts });
        });
    });
});

// Kitap detay sayfası için o kitaba ait konuları bul
router.get('/books/:key/topics', (req, res) => {
    // key format corresponds to OpenLibrary, e.g. /works/OL12345W
    const bookKey = '/works/' + req.params.key;
    const query = `SELECT topics.id, topics.title, topics.content, topics.views, topics.created_at, topics.book_reference_title, topics.book_cover_url,
                   users.username, users.avatar_url,
                   (SELECT COUNT(*) FROM posts WHERE posts.topic_id = topics.id) as reply_count
                   FROM topics 
                   LEFT JOIN users ON topics.user_id = users.id
                   WHERE IFNULL(topics.is_hidden, 0) = 0 AND (topics.book_key = ? OR topics.book_reference_title LIKE ?)
                   ORDER BY topics.created_at DESC LIMIT 10`;
    
    // Fallback search with title if book_key is not perfectly matched
    const fallbackTitle = `%${req.query.title || ''}%`;
    db.all(query, [bookKey, fallbackTitle], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

router.post('/topics/:id/posts', requireAuth, requireWriteAccess, async (req, res) => {
    const topicId = req.params.id;
    const { content, as_username } = req.body;
    let user_id = req.user.id;

    if (!content) return res.status(400).json({ error: 'Cevabınız boş bir yaprak olamaz.' });

    if (req.user.is_admin && as_username && as_username.trim() !== '') {
        const username = as_username.trim();
        db.get("SELECT id FROM users WHERE username = ?", [username], async (err, row) => {
            if (row) {
                user_id = row.id;
                insertPost();
            } else {
                const bcrypt = require('bcrypt');
                const hashedPassword = await bcrypt.hash(require('crypto').randomBytes(24).toString('hex'), 10);
                const avatar = `https://api.dicebear.com/7.x/initials/svg?seed=${username}&backgroundColor=1A1A1A&textColor=D4AF37&bold=true`;
                const email = username.toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(Math.random()*1000) + '@okuryazmaz.com';
                
                db.run('INSERT INTO users (username, email, password, avatar_url, is_ai) VALUES (?, ?, ?, ?, 1)', 
                    [username, email, hashedPassword, avatar], function(err) {
                        if (err) return res.status(500).json({ error: err.message });
                        user_id = this.lastID;
                        insertPost();
                });
            }
        });
    } else {
        insertPost();
    }

    function insertPost() {
        const stmt = db.prepare('INSERT INTO posts (topic_id, user_id, content) VALUES (?, ?, ?)');
        stmt.run([topicId, user_id, content], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            const newPostId = this.lastID;

            db.get("SELECT user_id, title FROM topics WHERE id = ?", [topicId], (err, topic) => {
                if (!err && topic && topic.user_id !== user_id) {
                    db.run("INSERT INTO notifications (user_id, sender_id, type, source_id, message) VALUES (?, ?, ?, ?, ?)",
                        [topic.user_id, user_id, 'reply', topicId, `"${topic.title}" başlıklı konunuza yeni bir ileti bırakıldı.`]);
                }
            });

            botManager.handleNewPost(topicId, newPostId, user_id, content);

            res.status(201).json({ message: 'Yorumunuz kitaba dahil edildi.', postId: newPostId });
        });
        stmt.finalize();
    }
});

router.put('/posts/:id', requireAuth, (req, res) => {
    const { content } = req.body;
    if(!content) return res.status(400).json({ error: 'İçerik boş olamaz.' });

    db.get("SELECT user_id, content FROM posts WHERE id = ?", [req.params.id], (err, post) => {
        if (err || !post) return res.status(404).json({ error: 'İleti bulunamadı.' });
        if (post.user_id !== req.user.id && !req.user.is_admin) {
            return res.status(403).json({ error: 'Sadece kendi satırlarınızı düzeltebilirsiniz.' });
        }

        db.run("INSERT INTO edit_history (target_type, target_id, old_content) VALUES (?, ?, ?)",
            ['post', req.params.id, post.content]);

        db.run("UPDATE posts SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [content, req.params.id], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'İleti başarıyla güncellendi.' });
            });
    });
});

// Son eklenen konular (Ana sayfa için)
router.get('/recent-topics', (req, res) => {
    const query = `SELECT topics.id, topics.title, topics.content, topics.views, topics.created_at, topics.book_reference_title, topics.book_cover_url,
                   users.username, users.avatar_url,
                   categories.title as category_name,
                   (SELECT COUNT(*) FROM posts WHERE posts.topic_id = topics.id) as reply_count
                   FROM topics 
                   LEFT JOIN users ON topics.user_id = users.id
                   LEFT JOIN categories ON topics.category_id = categories.id
                   WHERE IFNULL(topics.is_hidden, 0) = 0
                   ORDER BY topics.created_at DESC LIMIT 6`;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Kütüphane istatistikleri (Ana sayfa için)
router.get('/stats', (req, res) => {
    db.get(`SELECT
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM topics) as topics,
        (SELECT COUNT(*) FROM posts) as posts,
        (SELECT COUNT(*) FROM categories) as categories
    `, (err, stats) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(stats);
    });
});

// Son kayıt olan üyeler (Ana sayfa için)
router.get('/recent-members', (req, res) => {
    db.all(`SELECT id, username, avatar_url, created_at FROM users ORDER BY created_at DESC LIMIT 8`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Kitap çeviri endpoint'i (Google Translate API)
router.post('/translate-book', async (req, res) => {
    const { title, description, subjects } = req.body;
    
    try {
        const axios = require('axios');
        
        async function translateText(text) {
            if (!text) return '';
            // sl=auto ile kaynak dili otomatik algılıyoruz (örneğin Almanca, Fransızca vs. sorunsuz çevrilir)
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t&q=${encodeURIComponent(text)}`;
            const response = await axios.get(url);
            if (response.data && response.data[0]) {
                return response.data[0].map(item => item[0]).join('');
            }
            return text;
        }

        const tTitle = await translateText(title);
        // Biyografileri kesmemek için limiti kaldırdık (Google translate 5000 karaktere kadar destekler)
        const tDesc = await translateText(description || '');
        const tSubj = await translateText(subjects);

        res.json({
            title: tTitle,
            description: tDesc,
            subjects: tSubj
        });
    } catch (e) {
        console.error("Çeviri hatası:", e.message);
        res.json({ title, description, subjects });
    }
});

// ==========================================
// ALINTILAR (QUOTES) API
// ==========================================

// Yeni Alıntı Ekle
router.post('/quotes', requireAuth, requireWriteAccess, async (req, res) => {
    const { content, book_key, book_title } = req.body;
    if (!content || !book_title) return res.status(400).json({ error: 'İçerik ve kitap adı zorunludur.' });
    
    // As_username desteği (botlar için)
    let user_id = req.user.id;
    if (req.user.is_admin && req.body.as_username) {
        try {
            const botUser = await new Promise((resolve, reject) => {
                db.get("SELECT id FROM users WHERE username = ?", [req.body.as_username], (err, row) => {
                    if (err) reject(err); else resolve(row);
                });
            });
            if (botUser) user_id = botUser.id;
        } catch(e) {}
    }

    const b_key_raw = book_key && book_key.startsWith('/works/') ? book_key : (book_key ? '/works/' + book_key : null);

    // OpenLibrary'den yazar ve kapak bilgisi çek
    let bookAuthor = req.body.book_author || null;
    let bookCoverUrl = req.body.book_cover_url || null;
    let finalBookKey = b_key_raw;
    
    const axios = require('axios');
    
    // Eğer book_key yoksa, başlıktan arayalım
    if (!finalBookKey && book_title) {
        try {
            const searchRes = await axios.get(`https://openlibrary.org/search.json?title=${encodeURIComponent(book_title)}&limit=1`, { timeout: 5000 });
            if (searchRes.data.docs && searchRes.data.docs.length > 0) {
                const doc = searchRes.data.docs[0];
                finalBookKey = doc.key; // örn: /works/OL12345W
                if (doc.author_name && doc.author_name.length > 0) bookAuthor = doc.author_name[0];
                if (doc.cover_i) bookCoverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
            }
        } catch(e) { console.log('OpenLibrary arama hatası:', e.message); }
    }
    
    // book_key varsa ama yazar/kapak yoksa, works API'den çekelim
    if (finalBookKey && (!bookAuthor || !bookCoverUrl)) {
        try {
            const workKey = finalBookKey.replace('/works/', '');
            const workRes = await axios.get(`https://openlibrary.org/works/${workKey}.json`, { timeout: 3000 });
            
            if (!bookCoverUrl && workRes.data.covers && workRes.data.covers.length > 0) {
                bookCoverUrl = `https://covers.openlibrary.org/b/id/${workRes.data.covers[0]}-M.jpg`;
            }
            
            if (!bookAuthor && workRes.data.authors && workRes.data.authors.length > 0) {
                const authorKey = workRes.data.authors[0].author ? workRes.data.authors[0].author.key : null;
                if (authorKey) {
                    const authorRes = await axios.get(`https://openlibrary.org${authorKey}.json`, { timeout: 3000 });
                    if (authorRes.data.name) bookAuthor = authorRes.data.name;
                }
            }
        } catch(e) { console.log('OpenLibrary works hatası:', e.message); }
    }

    db.run("INSERT INTO quotes (user_id, book_key, book_title, book_author, book_cover_url, content) VALUES (?, ?, ?, ?, ?, ?)", 
        [user_id, finalBookKey, book_title, bookAuthor, bookCoverUrl, content], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: 'Alıntı kütüphaneye eklendi.', quoteId: this.lastID });
    });
});

// Ana Akış - Tüm Alıntıları Getir
router.get('/quotes', (req, res) => {
    const user_id = req.user ? req.user.id : 0; // opsiyonel auth kontrolü için auth middleware konmamış rotada req.user olmaz, o yüzden frontend'de jwt decode edersek fena olmaz ama neyse, DB'den user_id yi frontend'den query string ile alalım:
    const currentUserId = req.query.uid || 0;

    const query = `
        SELECT quotes.*, users.username, users.avatar_url,
        (SELECT COUNT(*) FROM quote_likes WHERE quote_likes.quote_id = quotes.id AND quote_likes.user_id = ?) as is_liked
        FROM quotes
        LEFT JOIN users ON quotes.user_id = users.id
        ORDER BY quotes.created_at DESC LIMIT 50
    `;
    db.all(query, [currentUserId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Belirli Kitabın Alıntıları
router.get('/books/:key/quotes', (req, res) => {
    const bookKey = '/works/' + req.params.key;
    const currentUserId = req.query.uid || 0;
    const fallbackTitle = `%${req.query.title || ''}%`;

    const query = `
        SELECT quotes.*, users.username, users.avatar_url,
        (SELECT COUNT(*) FROM quote_likes WHERE quote_likes.quote_id = quotes.id AND quote_likes.user_id = ?) as is_liked
        FROM quotes
        LEFT JOIN users ON quotes.user_id = users.id
        WHERE quotes.book_key = ? OR quotes.book_title LIKE ?
        ORDER BY quotes.likes_count DESC, quotes.created_at DESC LIMIT 20
    `;
    db.all(query, [currentUserId, bookKey, fallbackTitle], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Alıntı Beğen / Beğenmekten Vazgeç
router.post('/quotes/:id/like', requireAuth, (req, res) => {
    const quoteId = req.params.id;
    const userId = req.user.id;

    db.get("SELECT * FROM quote_likes WHERE user_id = ? AND quote_id = ?", [userId, quoteId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        if (row) {
            // Un-like
            db.run("DELETE FROM quote_likes WHERE user_id = ? AND quote_id = ?", [userId, quoteId], err => {
                if (!err) db.run("UPDATE quotes SET likes_count = likes_count - 1 WHERE id = ?", [quoteId]);
                res.json({ liked: false });
            });
        } else {
            // Like
            db.run("INSERT INTO quote_likes (user_id, quote_id) VALUES (?, ?)", [userId, quoteId], err => {
                if (!err) db.run("UPDATE quotes SET likes_count = likes_count + 1 WHERE id = ?", [quoteId]);
                res.json({ liked: true });
            });
        }
    });
});

// Admin: Alıntı Sil
router.delete('/quotes/:id', requireAuth, (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Yetkiniz yok.' });
    const quoteId = req.params.id;
    db.run("DELETE FROM quote_likes WHERE quote_id = ?", [quoteId]);
    db.run("DELETE FROM quotes WHERE id = ?", [quoteId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Alıntı silindi.' });
    });
});

// Yazara Göre Alıntılar
router.get('/quotes/by-author/:author', (req, res) => {
    const author = decodeURIComponent(req.params.author);
    const currentUserId = req.query.uid || 0;
    const query = `
        SELECT quotes.*, users.username, users.avatar_url,
        (SELECT COUNT(*) FROM quote_likes WHERE quote_likes.quote_id = quotes.id AND quote_likes.user_id = ?) as is_liked
        FROM quotes
        LEFT JOIN users ON quotes.user_id = users.id
        WHERE quotes.book_author LIKE ?
        ORDER BY quotes.likes_count DESC, quotes.created_at DESC LIMIT 50
    `;
    db.all(query, [currentUserId, `%${author}%`], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// [KALDIRILDI] Duplicate route — GET /books/:key/quotes zaten satır 433'te tanımlı.

// Benzersiz yazar listesi (sitemap ve filtre için)
router.get('/quotes/authors', (req, res) => {
    db.all("SELECT book_author, COUNT(*) as quote_count FROM quotes WHERE book_author IS NOT NULL AND book_author != '' GROUP BY book_author ORDER BY quote_count DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ==========================================
// KİTAP PUANLAMA (RATINGS) API
// ==========================================

// Kitabın Puan Durumunu Getir
router.get('/books/:key/ratings', (req, res) => {
    const bookKey = req.params.key.startsWith('OL') ? '/works/' + req.params.key : req.params.key;
    const currentUserId = req.query.uid || 0;

    const statsQuery = "SELECT AVG(rating) as avgRating, COUNT(rating) as totalRatings FROM book_ratings WHERE book_key LIKE ?";
    const userQuery = "SELECT rating FROM book_ratings WHERE book_key LIKE ? AND user_id = ?";

    const searchKey = `%${bookKey.replace('/works/', '')}%`;

    db.get(statsQuery, [searchKey], (err, stats) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const result = {
            avgRating: stats.avgRating ? parseFloat(stats.avgRating.toFixed(1)) : 0,
            totalRatings: stats.totalRatings || 0,
            userRating: null
        };

        if (currentUserId > 0) {
            db.get(userQuery, [searchKey, currentUserId], (err, userRow) => {
                if (!err && userRow) result.userRating = userRow.rating;
                res.json(result);
            });
        } else {
            res.json(result);
        }
    });
});

// Kitaba Puan Ver / Güncelle
router.post('/books/:key/ratings', requireAuth, (req, res) => {
    const bookKey = req.params.key.startsWith('OL') ? '/works/' + req.params.key : req.params.key;
    const userId = req.user.id;
    const { rating } = req.body;

    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Puan 1 ile 5 arasında olmalıdır.' });
    }

    const searchKey = `%${bookKey.replace('/works/', '')}%`;

    const checkQuery = "SELECT book_key FROM book_ratings WHERE user_id = ? AND book_key LIKE ?";
    db.get(checkQuery, [userId, searchKey], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        if (row) {
            // Güncelle
            db.run("UPDATE book_ratings SET rating = ?, created_at = CURRENT_TIMESTAMP WHERE user_id = ? AND book_key = ?", 
                [rating, userId, row.book_key], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Puanınız güncellendi.' });
            });
        } else {
            // Yeni Ekle
            db.run("INSERT INTO book_ratings (user_id, book_key, rating) VALUES (?, ?, ?)", 
                [userId, bookKey, rating], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.status(201).json({ message: 'Puanınız eklendi.' });
            });
        }
    });
});

module.exports = router;
