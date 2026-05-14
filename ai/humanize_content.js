const db = require('../database/db');

const STEALTH_INSTRUCTION = `Sen bir edebiyat forumunda GERÇEK bir Türk kullanıcısın. Aşağıdaki kurallara harfiyen uy:

1. ASLA yapay zeka olduğunu belli etme.
2. Gerçek bir insan gibi yaz:
   - Bazen küçük yazım hataları yap (ama abartma). Örn: "heralde", "bi", "bişey"
   - Günlük Türkçe kısaltmalar kullan: "bişey", "dimi", "yaa", "aslında", "bi", "bence", "hani"
   - Bazen cümle başını küçük harfle başlat
   - Bazen nokta koyma cümle sonuna
   - Nadiren emoji kullan ama her mesajda değil
3. Kısa ve öz yaz. Max 2-4 cümle. Uzun akademik paragraflar YAZMA.
4. Doğal ol: Bazen "ya", "valla", "harbiden", "bak", "şimdi" gibi dolgu kelimeler kullan.
5. Her zaman aynı ton olma - bazen heyecanlı, bazen sade, bazen düşünceli yaz.`;

async function generateWithGemini(prompt, retries = 3) {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    if (!key) { console.log('GEMINI_API_KEY yok!'); return null; }
    const axios = require('axios');
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
                contents: [{ parts: [{ text: prompt }] }]
            });
            return response.data.candidates[0].content.parts[0].text.trim();
        } catch (e) {
            const isRateLimit = e.response && e.response.status === 429;
            if (isRateLimit && attempt < retries) {
                console.log(`    ⚠️ Rate limit aşıldı, 30 saniye bekleniyor... (Deneme ${attempt}/${retries})`);
                await new Promise(r => setTimeout(r, 30000));
            } else {
                console.log("Gemini hatası:", e.response ? e.response.data.error.message : e.message);
                return null;
            }
        }
    }
    return null;
}

function getAllBotTopics() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT topics.id, topics.title, topics.content, users.about_me 
                FROM topics INNER JOIN users ON topics.user_id = users.id 
                WHERE users.is_ai = 1`, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function getAllBotPosts() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT posts.id, posts.content, users.about_me, topics.title as topic_title
                FROM posts INNER JOIN users ON posts.user_id = users.id
                INNER JOIN topics ON posts.topic_id = topics.id
                WHERE users.is_ai = 1`, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function updateTopic(id, content) {
    return new Promise((resolve, reject) => {
        db.run('UPDATE topics SET content = ? WHERE id = ?', [content, id], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function updatePost(id, content) {
    return new Promise((resolve, reject) => {
        db.run('UPDATE posts SET content = ? WHERE id = ?', [content, id], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function humanizeAll() {
    require('dotenv').config();
    console.log('🔄 Bot içerikleri insansılaştırılıyor...\n');

    // Konuları insansılaştır
    const topics = await getAllBotTopics();
    console.log(`📝 ${topics.length} bot konusu bulundu.`);
    
    for (let i = 0; i < topics.length; i++) {
        const t = topics[i];
        console.log(`  [${i+1}/${topics.length}] Konu: "${t.title.substring(0, 50)}..."`);
        
        const prompt = `${STEALTH_INSTRUCTION}
Senin kişiliğin: "${t.about_me}"
Aşağıdaki forum gönderisini gerçek bir insan yazmış gibi yeniden yaz. 
Konuyu ve anlamı koru ama dili günlük, doğal, insansı yap.
Kısa tut (3-4 cümle max).

Orijinal: "${t.content}"

Sadece yeniden yazılmış metni döndür, başka bir şey ekleme.`;

        const rewritten = await generateWithGemini(prompt);
        if (rewritten) {
            const clean = rewritten.replace(/^["']|["']$/g, '').trim();
            await updateTopic(t.id, clean);
            console.log(`    ✅ Güncellendi.`);
        } else {
            console.log(`    ❌ Atlandı (API hatası).`);
        }
        await sleep(4200); // Rate limiting
    }

    // Yorumları insansılaştır
    const posts = await getAllBotPosts();
    console.log(`\n💬 ${posts.length} bot yorumu bulundu.`);
    
    for (let i = 0; i < posts.length; i++) {
        const p = posts[i];
        console.log(`  [${i+1}/${posts.length}] Yorum (konu: "${p.topic_title.substring(0, 40)}...")`);
        
        const prompt = `${STEALTH_INSTRUCTION}
Senin kişiliğin: "${p.about_me}"
Aşağıdaki forum yorumunu gerçek bir insan yazmış gibi yeniden yaz.
Konu başlığı: "${p.topic_title}"
Anlamı koru ama dili günlük, samimi, doğal yap. Max 2-3 cümle.

Orijinal: "${p.content}"

Sadece yeniden yazılmış metni döndür, başka bir şey ekleme.`;

        const rewritten = await generateWithGemini(prompt);
        if (rewritten) {
            const clean = rewritten.replace(/^["']|["']$/g, '').trim();
            await updatePost(p.id, clean);
            console.log(`    ✅ Güncellendi.`);
        } else {
            console.log(`    ❌ Atlandı (API hatası).`);
        }
        await sleep(1500);
    }

    console.log('\n🎉 Tüm bot içerikleri insansılaştırıldı!');
    process.exit(0);
}

humanizeAll().catch(err => {
    console.error('Hata:', err);
    process.exit(1);
});
