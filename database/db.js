const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'okuryazmaz.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Veritabanına bağlanılamadı:', err.message);
    } else {
        console.log('Okuryazmaz Yeni SQLite Şeması başarıyla bağlandı.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE,
            password TEXT NOT NULL,
            avatar_url TEXT,
            about_me TEXT,
            is_ai BOOLEAN DEFAULT 0,
            is_admin BOOLEAN DEFAULT 0,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT 0`, (err) => {
        });
        db.run(`ALTER TABLE users ADD COLUMN is_banned BOOLEAN DEFAULT 0`, (err) => {});
        db.run(`ALTER TABLE users ADD COLUMN ban_reason TEXT`, (err) => {});
        db.run(`ALTER TABLE users ADD COLUMN is_muted BOOLEAN DEFAULT 0`, (err) => {});
        db.run(`ALTER TABLE users ADD COLUMN muted_until DATETIME`, (err) => {});
        db.run(`ALTER TABLE users ADD COLUMN ip_address TEXT`, (err) => {});

        db.run(`CREATE TABLE IF NOT EXISTS followers (
            follower_id INTEGER NOT NULL,
            following_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (follower_id, following_id),
            FOREIGN KEY(follower_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(following_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS topics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER,
            user_id INTEGER,
            title TEXT NOT NULL,
            content TEXT,
            views INTEGER DEFAULT 0,
            book_reference_title TEXT,
            book_cover_url TEXT,
            book_author TEXT,
            book_pages TEXT,
            book_publish_date TEXT,
            is_hidden BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        )`);

        db.run(`ALTER TABLE topics ADD COLUMN is_hidden BOOLEAN DEFAULT 0`, (err) => {
        });
        db.run(`ALTER TABLE topics ADD COLUMN book_key TEXT`, (err) => {});

        db.run(`CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic_id INTEGER,
            user_id INTEGER,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME,
            FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        )`);

        db.run(`ALTER TABLE topics ADD COLUMN updated_at DATETIME`, (err) => {});
        db.run(`ALTER TABLE posts ADD COLUMN updated_at DATETIME`, (err) => {});

        db.run(`CREATE TABLE IF NOT EXISTS edit_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_type TEXT,
            target_id INTEGER,
            old_content TEXT,
            edited_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reporter_id INTEGER,
            target_type TEXT,
            target_id INTEGER,
            reason TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(reporter_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS quotes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            book_key TEXT,
            book_title TEXT,
            book_author TEXT,
            book_cover_url TEXT,
            content TEXT NOT NULL,
            likes_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        )`);
        db.run(`ALTER TABLE quotes ADD COLUMN book_author TEXT`, (err) => {});
        db.run(`ALTER TABLE quotes ADD COLUMN book_cover_url TEXT`, (err) => {});

        db.run(`CREATE TABLE IF NOT EXISTS quote_likes (
            user_id INTEGER,
            quote_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(user_id, quote_id),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(quote_id) REFERENCES quotes(id) ON DELETE CASCADE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            sender_id INTEGER,
            type TEXT,
            source_id INTEGER,
            message TEXT,
            is_read BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE SET NULL
        )`);

        // Favori Kitaplar
        db.run(`CREATE TABLE IF NOT EXISTS user_favorite_books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            book_title TEXT NOT NULL,
            book_author TEXT,
            book_cover_url TEXT,
            book_key TEXT,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Favori Yazarlar
        db.run(`CREATE TABLE IF NOT EXISTS user_favorite_authors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            author_name TEXT NOT NULL,
            author_photo_url TEXT,
            author_key TEXT,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Rozet Tanımları
        db.run(`CREATE TABLE IF NOT EXISTS badges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            icon TEXT,
            color TEXT DEFAULT '#D4AF37',
            category TEXT
        )`);

        // Kullanıcı Rozetleri
        db.run(`CREATE TABLE IF NOT EXISTS user_badges (
            user_id INTEGER NOT NULL,
            badge_id INTEGER NOT NULL,
            earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(user_id, badge_id),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(badge_id) REFERENCES badges(id) ON DELETE CASCADE
        )`);

        // Rozetleri seed et
        db.get('SELECT count(*) as count FROM badges', (err, row) => {
            if (row && row.count === 0) {
                const b = db.prepare('INSERT INTO badges (code, name, description, icon, color, category) VALUES (?, ?, ?, ?, ?, ?)');
                // YAZARLIK
                b.run('first_topic',      'İlk Mürekkep',       'İlk konunuzu açtınız.',                    'fa-feather',         '#D4AF37', 'writing');
                b.run('5_topics',         'Kalem Erbabı',       '5 konu açtınız.',                          'fa-pen-fancy',       '#C5A059', 'writing');
                b.run('15_topics',        'Mürekkep Ustası',    '15 konu açtınız.',                         'fa-pen-nib',         '#B8860B', 'writing');
                b.run('30_topics',        'Edebiyat Profesörü', '30 konu açtınız.',                         'fa-scroll',          '#FFD700', 'writing');
                b.run('50_topics',        'Söz Mimarı',         '50 konu açtınız. Efsanevi seviye.',        'fa-landmark',        '#FFA500', 'writing');
                // YORUM
                b.run('first_reply',      'İlk Söz',            'İlk yorumunuzu yaptınız.',                 'fa-comment',         '#D4AF37', 'engagement');
                b.run('10_replies',       'Eleştirmen',          '10 yorum yaptınız.',                       'fa-comments',        '#C5A059', 'engagement');
                b.run('30_replies',       'Hatip',               '30 yorum yaptınız.',                       'fa-microphone-lines','#B8860B', 'engagement');
                b.run('75_replies',       'Müzakereci',          '75 yorum yaptınız.',                       'fa-scale-balanced',  '#FFD700', 'engagement');
                b.run('150_replies',      'Söz Sultanı',         '150 yorum. Forumun sesi sizsiniz.',        'fa-crown',           '#FFA500', 'engagement');
                // SOSYAL
                b.run('3_followers',      'Tanıdık Yüz',        '3 takipçiye ulaştınız.',                   'fa-user-plus',       '#D4AF37', 'social');
                b.run('10_followers',     'Popüler Yazar',       '10 takipçiye ulaştınız.',                  'fa-star',            '#C5A059', 'social');
                b.run('25_followers',     'Fenomen',             '25 takipçi. Herkes sizi okuyor.',          'fa-fire',            '#FF6347', 'social');
                b.run('50_followers',     'Efsane',              '50 takipçi. Forum efsanesi.',              'fa-trophy',          '#FFD700', 'social');
                // KOLEKSİYON
                b.run('fav_books',        'Kitap Kurdu',         '3 favori kitap ekledinitiz.',              'fa-book-open',       '#D4AF37', 'collection');
                b.run('fav_authors',      'Edebiyat Aşığı',     '3 favori yazar eklediniz.',                'fa-bookmark',        '#C5A059', 'collection');
                // SADAKAT
                b.run('7_days',           'Sadık Okur',          '7 günlük üyelik.',                         'fa-clock',           '#D4AF37', 'loyalty');
                b.run('30_days',          'Kütüphane Sakini',    '30 günlük üyelik.',                        'fa-hourglass-half',  '#C5A059', 'loyalty');
                b.run('90_days',          'Antika',              '90 günlük üyelik. Platformun direği.',     'fa-hourglass-end',   '#B8860B', 'loyalty');
                b.run('180_days',         'Efsanevi Okur',       '180 günlük üyelik. Yaşayan tarih.',        'fa-gem',             '#FFD700', 'loyalty');
                // ÖZEL
                b.run('night_owl',        'Gece Kuşu',           'Gece yarısı ile şafak arası bir gönderi.', 'fa-moon',            '#6C63FF', 'special');
                b.run('early_bird',       'Şafak Nöbetçisi',     'Sabah 5-7 arası bir gönderi.',             'fa-sun',             '#F39C12', 'special');
                b.run('100_views',        'Çok Okunan',          'Bir konunuz 100 görüntülemeye ulaştı.',    'fa-binoculars',      '#1ABC9C', 'special');
                b.run('500_views',        'Viral',               'Bir konunuz 500 görüntülemeye ulaştı.',    'fa-bolt',            '#E74C3C', 'special');
                b.run('first_commenter',  'Erken Kuş',           'Bir konuya ilk yorumu yapan siz oldunuz.', 'fa-feather-pointed', '#9B59B6', 'special');
                b.finalize();
            }
        });

        db.get('SELECT count(*) as count FROM categories', (err, row) => {
            if (row && row.count === 0) {
                const insert = db.prepare('INSERT INTO categories (title, description) VALUES (?, ?)');
                insert.run('Romanlar & Kurgu', 'Mevcut romanlar üzerine detaylı serbest tartışmalar.');
                insert.run('Bilim Kurgu & Fantastik', 'Gelecekten gelen veya büyü ve mitoloji içeren kurgular.');
                insert.run('Felsefe & Düşünce', 'Dünyayı değiştiren edebi zihinler ve ideolojiler.');
                insert.run('Kitap Kulübü', 'Aylık okuma etkinlikleri, incelemeler ve eleştiriler.');
                insert.finalize();
            }
        });
    });
}

module.exports = db;
