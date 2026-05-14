const db = require('../database/db');
const bcrypt = require('bcrypt');

const DICEBEAR_STYLES = ['avataaars', 'adventurer', 'lorelei', 'notionists', 'personas', 'bottts', 'big-smile', 'micah'];

function getRandomAvatar(username) {
    const style = DICEBEAR_STYLES[Math.floor(Math.random() * DICEBEAR_STYLES.length)];
    return `https://api.dicebear.com/7.x/${style}/svg?seed=${username}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}

const aiPersonas = [
    { 
        username: 'Librarian', 
        email: 'lib@okuryazmaz.com', 
        password: 'pw', 
        avatar: 'https://api.dicebear.com/7.x/lorelei/svg?seed=Librarian&backgroundColor=c0aede',
        about: 'Kütüphane arşivlerinde ömür tüketmiş, akademik dile hakim, bibliyografik detaylara ve kitapların tarihsel arka planına odaklanan ağırbaşlı bir kişilik.'
    },
    { 
        username: 'Murat_Keser', 
        email: 'murat@okuryazmaz.com', 
        password: 'pw', 
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=MuratKeser&backgroundColor=ffd5dc',
        about: 'Eski ekol edebiyat eleştirmeni. Hafif huysuz, modern edebiyatı sıkça eleştiren, üslup ve yazım titizliği konusunda tavizsiz, "nerede o eski kalemler" diyen bir karakter.'
    },
    { 
        username: 'SuskunOkur', 
        email: 'okur@okuryazmaz.com', 
        password: 'pw', 
        avatar: 'https://api.dicebear.com/7.x/notionists/svg?seed=SuskunOkur&backgroundColor=d1d4f9',
        about: 'Kitapların ruhuna, uyandırdığı duygulara ve melankoliye odaklanan, bolca alıntı paylaşmayı seven, şiirsel bir dille konuşan hassas bir okur.'
    }
];

const STEALTH_INSTRUCTION = `Sen bir edebiyat forumunda GERÇEK bir Türk kullanıcısın. Aşağıdaki kurallara harfiyen uy:

1. ASLA yapay zeka olduğunu belli etme. "Bir model olarak", "Size yardımcı olmak" gibi kalıpları KESİNLİKLE kullanma.
2. Gerçek bir insan gibi yaz:
   - Bazen küçük yazım hataları yap (ama abartma). Örn: "heralde" yerine "herhalde", "bi" yerine "bir" vb.
   - Günlük Türkçe kısaltmalar kullan: "bişey", "dimi", "yaa", "aslında", "bi", "bence", "hani"
   - Bazen cümle başını küçük harfle başlat
   - Bazen nokta koyma cümle sonuna
   - Nadiren emoji kullan ama her mesajda değil
3. Kısa ve öz yaz. Max 2-4 cümle. Uzun akademik paragraflar YAZMA.
4. Doğal ol: Bazen "ya", "valla", "harbiden", "bak", "şimdi" gibi dolgu kelimeler kullan.
5. Her zaman aynı ton olma - bazen heyecanlı, bazen sade, bazen düşünceli yaz.`;

async function initializeAIBots() {
    console.log('🤖 AI Personalar sisteme sıradan insan gibi yerleşiyor...');
    const hashedPassword = await bcrypt.hash(require('crypto').randomBytes(24).toString('hex'), 10);

    db.serialize(() => {
        aiPersonas.forEach(persona => {
            db.get("SELECT id FROM users WHERE username = ? OR email = ?", [persona.username, persona.email], (err, user) => {
                if (!user) {
                    const stmt = db.prepare('INSERT INTO users (username, email, password, avatar_url, about_me, is_ai) VALUES (?, ?, ?, ?, ?, 1)');
                    stmt.run([persona.username, persona.email, hashedPassword, persona.avatar, persona.about]);
                    stmt.finalize();
                } else {
                    db.run("UPDATE users SET about_me = ?, avatar_url = ?, is_ai = 1 WHERE id = ?", [persona.about, persona.avatar, user.id]);
                }
            });
        });
    });
}

async function generateWithGemini(prompt) {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    if (!key) return null;
    const axios = require('axios');
    try {
        const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
            contents: [{ parts: [{ text: prompt }] }]
        });
        return response.data.candidates[0].content.parts[0].text.trim();
    } catch (e) {
        console.log("Gemini API Hatası:", e.response ? e.response.data : e.message);
        return null;
    }
}

async function getRecentContext() {
    return new Promise((resolve) => {
        db.all("SELECT title FROM topics ORDER BY created_at DESC LIMIT 15", (err, rows) => {
            if (err || !rows) resolve("");
            else resolve(rows.map(r => r.title).join(", "));
        });
    });
}

function simulateAIPosting() {
    db.get("SELECT id, username, about_me FROM users WHERE is_ai = 1 ORDER BY RANDOM() LIMIT 1", async (err, bot) => {
        if (!bot) return;
        
        // Günlük konu limiti kontrolü (tüm AI botlar toplamında günde max 2 konu)
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const canPostTopic = await new Promise((resolve) => {
            db.get(
                `SELECT COUNT(*) as count FROM topics 
                 WHERE user_id IN (SELECT id FROM users WHERE is_ai = 1) 
                 AND date(created_at) = date(?)`, 
                [today], 
                (err, row) => {
                    resolve(!err && row && row.count < 2);
                }
            );
        });
        
        // Olasılıklar: %70 Yorum, %20 Alıntı, %10 Konu (limit dahilinde)
        const rand = Math.random();
        const shouldReply = rand > 0.3;
        const shouldQuote = rand <= 0.3 && rand > 0.1;
        
        if (shouldReply) {
            db.get("SELECT id, title, content FROM topics WHERE IFNULL(is_hidden, 0) = 0 ORDER BY RANDOM() LIMIT 1", async (err, topic) => {
                if (topic) {
                    const intents = ["Destekle ve kısa yorum yap", "Hafifçe katılma ya da sorgula", "Eserden aklına gelen bişey paylaş", "Konu sahibine kısa bir soru sor", "Kendi deneyiminden kısaca bahset"];
                    const intent = intents[Math.floor(Math.random() * intents.length)];
                    
                    const prompt = `${STEALTH_INSTRUCTION}
                    Senin kişiliğin: "${bot.about_me}". 
                    Şu anki niyetin: "${intent}".
                    Şu konuya kısa (max 2-3 cümle), samimi ve özgün bir yanıt ver. 
                    Konu: "${topic.title}", İçerik: "${topic.content}". 
                    Yapay zeka olduğunu asla belli etme, doğrudan yorumunu yaz. Başka hiçbir açıklama ekleme.`;

                    let aiReply = await generateWithGemini(prompt);
                    if (aiReply) {
                        // Temizle - bazen Gemini tırnak içinde döndürüyor
                        aiReply = aiReply.replace(/^["']|["']$/g, '').trim();
                        db.run('INSERT INTO posts (topic_id, user_id, content) VALUES (?, ?, ?)', [topic.id, bot.id, aiReply]);
                        console.log(`✨ [${bot.username}] otonom olarak yorum yaptı.`);
                    }
                }
            });
        } else if (shouldQuote) {
            console.log(`📖 [${bot.username}] otonom olarak bir alıntı paylaşıyor.`);
            postNewQuote(bot);
        } else if (canPostTopic) {
            console.log(`📝 [${bot.username}] yeni konu açmaya çalışıyor (bugünkü limit uygun).`);
            postNewTopic(bot);
        }
    });
}

async function postNewQuote(bot) {
    const recentQuotes = await new Promise(resolve => {
        db.all("SELECT content FROM quotes ORDER BY created_at DESC LIMIT 10", (err, rows) => {
            if (err || !rows) resolve([]);
            else resolve(rows.map(r => r.content));
        });
    });
    
    const avoidText = recentQuotes.length > 0 ? `\nŞU ALINTILARI KESİNLİKLE KULLANMA (çok yakın zamanda paylaşıldı): ${recentQuotes.join(' | ')}` : '';
    const themes = ["aşk", "yalnızlık", "varoluş", "zaman", "kader", "umut", "dostluk", "ihanet", "toplum", "doğa", "melankoli", "bilgelik", "hayal kırıklığı"];
    const randomTheme = themes[Math.floor(Math.random() * themes.length)];

    const prompt = `Sen "${bot.about_me}" karakterine sahip bir okursun. 
    Lütfen edebiyat dünyasından "${randomTheme}" temalı, ÇARPICI ve unutulmaz bir alıntı paylaş. Hep aynı kitapları seçmek yerine çeşitli yazarlardan seç.${avoidText}
    KURALLAR:
    1. SADECE VE SADECE alıntının metnini yazacaksın. Kendi yorumunu KESİNLİKLE KATMA. Merhaba vb deme.
    2. Alıntı çok uzun olmasın (1-3 cümle).
    3. Sadece JSON formatında dön: {"book_title": "Kitap Adı", "quote": "Alıntının ta kendisi."}.
    Başka HİÇBİR AÇIKLAMA ekleme.`;

    let res = await generateWithGemini(prompt);
    if (!res) return;
    try {
        res = res.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
        const data = JSON.parse(res);
        if (data.book_title && data.quote) {
            const axios = require('axios');
            let bookKey = null;
            let bookAuthor = null;
            let bookCoverUrl = null;
            
            try {
                const searchRes = await axios.get(`https://openlibrary.org/search.json?title=${encodeURIComponent(data.book_title)}&limit=1`, { timeout: 5000 });
                if (searchRes.data.docs && searchRes.data.docs.length > 0) {
                    const doc = searchRes.data.docs[0];
                    bookKey = doc.key;
                    if (doc.author_name && doc.author_name.length > 0) bookAuthor = doc.author_name[0];
                    if (doc.cover_i) bookCoverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
                }
            } catch(e) {}

            db.run('INSERT INTO quotes (user_id, book_title, book_key, book_author, book_cover_url, content) VALUES (?, ?, ?, ?, ?, ?)', 
                [bot.id, data.book_title, bookKey, bookAuthor, bookCoverUrl, data.quote]);
            if (bookKey) {
                // AI Botlar kötü puan da verebilir, çoğunlukla 3-5
                const rating = Math.random() < 0.2 ? Math.floor(Math.random() * 2) + 1 : Math.floor(Math.random() * 3) + 3;
                const cleanKey = bookKey.replace('/works/', '');
                db.run('INSERT OR REPLACE INTO book_ratings (user_id, book_key, rating) VALUES (?, ?, ?)', [bot.id, cleanKey, rating]);
            }
            console.log(`✨ [${bot.username}] Alıntı Paylaştı: ${data.book_title} — ${bookAuthor || 'Yazar bilinmiyor'} (Puan: ${bookKey ? 'Verildi' : 'Yok'})`);
        }
    } catch(e) {
        console.error('Alıntı botu JSON parse hatası:', e.message);
    }
}

async function postNewTopic(bot) {
    const recentTopics = await getRecentContext();
    const prompt = `${STEALTH_INSTRUCTION}
    Senin kişiliğin: "${bot.about_me}".
    Forumda yeni bir konu başlatacaksın. Şu konular zaten açıldı: [${recentTopics}]. 
    Lütfen bu konulardan FARKLI, özgün bir eser incelemesi veya edebi tartışma konusu üret.
    İçeriği kısa tut (3-4 cümle max), günlük dilde yaz.
    Sadece ve sadece şu formatta JSON dön: {"title": "Başlık", "content": "İçerik", "book_reference": "Kitap Adı"}.
    Başka hiçbir şey ekleme.`;

    let rawJson = await generateWithGemini(prompt);
    if (!rawJson) return;

    try {
        rawJson = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();
        const aiTopicData = JSON.parse(rawJson);
        
        const axios = require('axios');
        let coverUrl = null, author = null, pages = null, releaseDate = null, bookKey = null;
        try {
            const searchRes = await axios.get(`https://openlibrary.org/search.json?title=${encodeURIComponent(aiTopicData.book_reference)}&limit=5`);
            if(searchRes.data.docs && searchRes.data.docs.length > 0) {
                const book = searchRes.data.docs.find(item => item.cover_i) || searchRes.data.docs[0];
                bookKey = book.key;
                coverUrl = book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg` : null;
                author = book.author_name ? book.author_name.join(', ') : 'Bilinmeyen Yazar';
                pages = book.number_of_pages_median || '-';
                releaseDate = book.first_publish_year || '-';
            }
        } catch(e) {}

        const cat_id = Math.floor(Math.random() * 4) + 1;
        db.run('INSERT INTO topics (category_id, user_id, title, content, book_reference_title, book_cover_url, book_author, book_pages, book_publish_date, book_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
            [cat_id, bot.id, aiTopicData.title, aiTopicData.content, aiTopicData.book_reference, coverUrl, author, pages, releaseDate, bookKey], function(err) {
            if (!err) {
                console.log(`✨ [${bot.username}] otonom olarak yeni bir konu neşretti.`);
                if (bookKey) {
                    const rating = Math.random() < 0.2 ? Math.floor(Math.random() * 2) + 1 : Math.floor(Math.random() * 3) + 3;
                    const cleanKey = bookKey.replace('/works/', '');
                    db.run('INSERT OR REPLACE INTO book_ratings (user_id, book_key, rating) VALUES (?, ?, ?)', [bot.id, cleanKey, rating]);
                }
            }
        });
    } catch(e) { console.log('Bot konu üretirken JSON hatası aldı.'); }
}

function simulateAIViews() {
    db.all(`
        SELECT t.id, t.views 
        FROM topics t
        JOIN users u ON t.user_id = u.id
        WHERE u.is_ai = 1 AND t.views < 30
    `, (err, topics) => {
        if (err || !topics) return;
        topics.forEach(topic => {
            // Pseudo-random max views per topic, between 5 and 30
            const maxViews = (topic.id * 17) % 26 + 5; 
            if (topic.views < maxViews) {
                // Rastgele olarak bu tick'te arttır (böylece zamana yayılmış olur)
                if (Math.random() > 0.6) {
                    db.run('UPDATE topics SET views = views + 1 WHERE id = ?', [topic.id]);
                }
            }
        });
    });
}

function startAutonomousLoop() {
    const nextAction = () => {
        const delay = (Math.floor(Math.random() * 60) + 30) * 60 * 1000;
        setTimeout(() => {
            simulateAIPosting();
            nextAction();
        }, delay);
    };
    
    setTimeout(() => {
        simulateAIPosting();
        nextAction();
    }, 10000);

    // Her 3 dakikada bir AI konularının görüntülenmelerini (view) simüle et
    setInterval(() => {
        simulateAIViews();
    }, 3 * 60 * 1000);
}

module.exports = { initializeAIBots, simulateAIPosting, startAutonomousLoop, getRandomAvatar };
