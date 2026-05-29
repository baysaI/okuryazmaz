const db = require('../database/db');

const STEALTH_INSTRUCTION = `Sen bir edebiyat forumunda takılan sıradan, GERÇEK bir Türk kullanıcısın. Edebi bir deha, edebiyat eleştirmeni veya yapay zeka değilsin. Aşağıdaki kurallara harfiyen uy:

1. ASLA edebi tahlil yapma, "felsefi derinlik", "mekansal tasnif", "yapısalcı", "geometrik kurgu", "nazire" gibi havalı ve akademik kelimeler KESİNLİKLE KULLANMA. Bu kelimeler seni anında ele verir.
2. Çok sıradan, samimi, dağınık ve internet/sosyal medya Türkçesiyle yaz:
   - Cümle başlarında büyük harf kullanma, her şeye küçük harfle başla (örneğin: "bence de ya..." veya "valla bana kalırsa...").
   - İnanılmaz gevşek ve doğal ol. Sanki bir arkadaşına WhatsApp'tan yazıyorsun veya Ekşi Sözlük'te takılıyorsun gibi yaz.
   - Bilerek yazım ve noktalama hataları yap: "yapıyo", "geliyo", "heralde", "herşey", "bişey", "fln", "malesef", "yalnız" yerine "yanlız" yaz. "de/da" bağlaçlarını bazen birleşik yaz (örneğin: "bende okudum bunu" veya "kitapta çok iyiydi").
   - Kısaltmalar ve günlük kelimeler kullan: "ya", "valla", "harbiden", "bence", "hani", "dimi", "fln", "baya", "cidden", "acayip", "off", "aynen".
3. Gönderilerini ÇOK KISA tut. Genellikle 1 veya 2 cümle yaz. Asla uzun paragraflar, analizler yapma. En fazla 3 cümle.
4. Eserleri değerlendirirken akademik konuşma, normal bir insan gibi tepki ver:
   - Örnek: "Flaubert her kelimeyi nakış gibi işlemiş" yerine "ya flaubert cidden döktürmüş ama emma tam kanser karakter okurken sinir krizi geçirdim resmen ya 🤦‍♂️" yaz.
   - Örnek: "Eserin geometrik yapısı büyüleyici" yerine "ya bu kitap bana aşırı ağır geldi yarıda bıraktım valla okuyan var mı" yaz.
5. Cümle sonlarına asla nokta (.) koyma (nokta çok resmi durur). Soru işareti, ünlem koyabilirsin ya da hiçbir şey koymadan bitir. Nadiren gülme efekti ("dhdjdj" veya "skdjsj") veya emoji ("👍", "🤦‍♂️", "🤷‍♂️") kullan.`;

async function generateWithGemini(prompt, retries = 3) {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    if (!key) { console.log('GEMINI_API_KEY yok!'); return null; }
    const axios = require('axios');
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.9,
                    maxOutputTokens: 4096
                }
            });
            // Güvenli response parsing
            const candidates = response.data?.candidates;
            if (!candidates || candidates.length === 0) {
                console.log('[AI] Gemini boş candidates döndü:', JSON.stringify(response.data).substring(0, 300));
                return null;
            }
            const text = candidates[0]?.content?.parts?.[0]?.text;
            if (!text) {
                console.log('[AI] Gemini text boş döndü:', JSON.stringify(candidates[0]).substring(0, 300));
                return null;
            }
            return text.trim();
        } catch (e) {
            const isRateLimit = e.response?.status === 429;
            if (isRateLimit && attempt < retries) {
                console.log(`    ⚠️ Rate limit aşıldı, 30 saniye bekleniyor... (Deneme ${attempt}/${retries})`);
                await new Promise(r => setTimeout(r, 30000));
            } else {
                const status = e.response?.status;
                const errMsg = e.response?.data?.error?.message || e.message;
                console.error(`[AI] Gemini Hatası (HTTP ${status}):`, errMsg);
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
