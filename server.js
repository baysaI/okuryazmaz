require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const forumRoutes = require('./routes/forum');
const profileRoutes = require('./routes/profile');
const adminRoutes = require('./routes/admin');
const reportRoutes = require('./routes/report');
const notificationRoutes = require('./routes/notification');

const app = express();
const PORT = process.env.PORT || 3000;
const db = require('./database/db');

app.use(cors());
app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    maxAge: 0,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Tüm API yanıtlarını cache'lenmekten koru
app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

app.use('/api/auth', authRoutes);
app.use('/api/forum', forumRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/report', reportRoutes);
app.use('/api/notification', notificationRoutes);

app.get('/api/health', (req, res) => {
    res.json({ status: 'success', message: 'Okuryazmaz Sunucusu ayakta ve çalışıyor!' });
});

// Catch-all: Tanımsız API yolları için JSON 404 döndür
app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'Bu API yolu bulunamadı.' });
});

// Sitemap için devasa bir kitap havuzunu asenkron olarak dolduralım (Programatik SEO)
let cachedPopularBooks = [];
const axios = require('axios');

function slugify(text) {
    if (!text) return '';
    const trMap = { 'çÇ':'c', 'ğĞ':'g', 'şŞ':'s', 'üÜ':'u', 'ıİ':'i', 'öÖ':'o' };
    for(let key in trMap) {
        text = text.replace(new RegExp('['+key+']','g'), trMap[key]);
    }
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}

async function fetchPopularBooksForSitemap() {
    console.log('[SEO] Hedef kitleye (Türkiye) özel dev kitap arşivi arka planda toplanmaya başlandı...');
    
    // Türklerin en çok okuduğu ve arattığı yazarlar ile Türkçe'ye çevrilmiş global kitaplar
    const queries = [
        { q: 'language:tur', limit: 1000 }, // Türkçe'ye çevrilmiş en popüler global kitaplar (Harry Potter, Dune vs.) ve Türk kitapları
        { q: 'author:"Sabahattin Ali"', limit: 50 },
        { q: 'author:"Orhan Pamuk"', limit: 100 },
        { q: 'author:"Oğuz Atay"', limit: 50 },
        { q: 'author:"Yaşar Kemal"', limit: 100 },
        { q: 'author:"Ahmet Hamdi Tanpınar"', limit: 50 },
        { q: 'author:"Fyodor Dostoevsky"', limit: 100 },
        { q: 'author:"Franz Kafka"', limit: 100 },
        { q: 'author:"Lev Tolstoy"', limit: 100 },
        { q: 'author:"George Orwell"', limit: 50 },
        { q: 'author:"Stefan Zweig"', limit: 100 },
        { q: 'author:"Zülfü Livaneli"', limit: 50 }
    ];
    
    for (const item of queries) {
        try {
            const res = await axios.get(`https://openlibrary.org/search.json?q=${encodeURIComponent(item.q)}&limit=${item.limit}`);
            if (res.data && res.data.docs) {
                res.data.docs.forEach(w => {
                    if (w.key) {
                        const key = w.key.replace('/works/', '');
                        if (!cachedPopularBooks.find(b => b.key === key)) {
                            cachedPopularBooks.push({ key, slug: slugify(w.title) });
                        }
                    }
                });
                console.log(`[SEO] Hedef Sorgu Eklendi: ${item.q} | Toplam Kitap: ${cachedPopularBooks.length}`);
            }
        } catch(e) {
            console.error(`[SEO] ${item.q} çekilirken hata:`, e.message);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    console.log(`[SEO] MÜKEMMEL! Türk okur kitlesine özel toplam ${cachedPopularBooks.length} kitap sitemap için belleğe alındı.`);
}
fetchPopularBooksForSitemap(); // Sunucu başlarken arka planda çalışmaya başlar

// SEO İçin Popüler Yazar Cache'i
let cachedPopularAuthors = [];
async function fetchPopularAuthorsForSitemap() {
    console.log("[SEO] Popüler yazar arşivi çekiliyor (Sitemap için)...");
    const popularAuthors = [
        "Sabahattin Ali", "Orhan Pamuk", "Oğuz Atay", "Yaşar Kemal", "Ahmet Hamdi Tanpınar",
        "Fyodor Dostoevsky", "Franz Kafka", "Lev Tolstoy", "George Orwell", "Stefan Zweig",
        "Zülfü Livaneli", "Halid Ziya Uşaklıgil", "Peyami Safa", "Reşat Nuri Güntekin",
        "Victor Hugo", "Albert Camus", "Jean-Paul Sartre", "Jane Austen", "Virginia Woolf"
    ];
    
    for (const authorName of popularAuthors) {
        try {
            const res = await axios.get(`https://openlibrary.org/search/authors.json?q=${encodeURIComponent(authorName)}&limit=1`);
            if (res.data && res.data.docs && res.data.docs.length > 0) {
                const key = res.data.docs[0].key;
                if (!cachedPopularAuthors.find(a => a.key === key)) {
                    cachedPopularAuthors.push({ key, slug: slugify(authorName) });
                }
            }
        } catch(e) {
            console.error(`[SEO] Yazar ${authorName} çekilirken hata:`, e.message);
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
    console.log(`[SEO] Toplam ${cachedPopularAuthors.length} yazar sitemap için belleğe alındı.`);
}
fetchPopularAuthorsForSitemap(); // Sunucu başlarken arka planda çalışmaya başlar

// SPA Fallback: Tüm diğer yollar için index.html döndür (API ve özel yollar hariç)
app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml');
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://okuryazmaz.com/</loc><priority>1.0</priority></url>
    <url><loc>https://okuryazmaz.com/kategori/1-romanlar-ve-kurgu</loc><priority>0.8</priority></url>
    <url><loc>https://okuryazmaz.com/kategori/2-bilim-kurgu-ve-fantastik</loc><priority>0.8</priority></url>
`;

    // Tüm konuları sitemap'e ekle
    db.all("SELECT id, title, updated_at FROM topics WHERE IFNULL(is_hidden, 0) = 0", [], (err, topics) => {
        if (!err && topics) {
            topics.forEach(t => {
                const slug = slugify(t.title) ? '-' + slugify(t.title) : '';
                const date = t.updated_at ? new Date(t.updated_at + 'Z').toISOString() : new Date().toISOString();
                xml += `    <url><loc>https://okuryazmaz.com/konu/${t.id}${slug}</loc><lastmod>${date}</lastmod><priority>0.9</priority></url>\n`;
            });
        }
        
        // Veritabanındaki benzersiz kitaplar
        db.all("SELECT DISTINCT book_key, book_reference_title FROM topics WHERE book_key IS NOT NULL", [], (err, dbBooks) => {
            let combinedBooks = [...cachedPopularBooks];
            
            if (!err && dbBooks) {
                dbBooks.forEach(b => {
                    const key = b.book_key.replace('/works/', '');
                    // Eğer veritabanındaki kitap cachedPopularBooks'da yoksa ekle
                    if (!combinedBooks.find(cb => cb.key === key)) {
                        combinedBooks.push({ key, slug: slugify(b.book_reference_title) });
                    }
                });
            }
            
            combinedBooks.forEach(book => {
                xml += `    <url><loc>https://okuryazmaz.com/kitap/${book.key}-${book.slug}</loc><priority>0.7</priority></url>\n`;
            });
            
            // Veritabanındaki benzersiz alıntı yazarları (Yazar sayfaları için)
            db.all("SELECT DISTINCT book_author FROM quotes WHERE book_author IS NOT NULL AND book_author != ''", [], (err, authors) => {
                if (!err && authors) {
                    authors.forEach(a => {
                        const authorSlug = slugify(a.book_author);
                        xml += `    <url><loc>https://okuryazmaz.com/alintilar/yazar/${authorSlug}</loc><priority>0.6</priority></url>\n`;
                    });
                }
                
                // Popüler Yazarlar
                cachedPopularAuthors.forEach(author => {
                    const cleanKey = author.key.replace('/authors/', '');
                    xml += `    <url><loc>https://okuryazmaz.com/yazar/${cleanKey}-${author.slug}</loc><priority>0.8</priority></url>\n`;
                });
                
                xml += `</urlset>`;
                res.send(xml);
            });
        });
    });
});

app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(`User-agent: *\nAllow: /\nSitemap: https://okuryazmaz.com/sitemap.xml\n`);
});

// SSR Meta Enjeksiyonu Fonksiyonu
function injectMetaTags(html, meta) {
    let newHtml = html;
    if (meta.title) {
        newHtml = newHtml.replace(/<title>.*?<\/title>/, `<title>${meta.title}</title>`);
        newHtml = newHtml.replace(/<meta property="og:title" content=".*?">/, `<meta property="og:title" content="${meta.title}">`);
        newHtml = newHtml.replace(/<meta name="twitter:title" content=".*?">/, `<meta name="twitter:title" content="${meta.title}">`);
    }
    if (meta.description) {
        // Çift tırnak sorununu önlemek için
        const cleanDesc = meta.description.replace(/"/g, '&quot;');
        newHtml = newHtml.replace(/<meta name="description" content=".*?">/, `<meta name="description" content="${cleanDesc}">`);
        newHtml = newHtml.replace(/<meta property="og:description" content=".*?">/, `<meta property="og:description" content="${cleanDesc}">`);
        newHtml = newHtml.replace(/<meta name="twitter:description" content=".*?">/, `<meta name="twitter:description" content="${cleanDesc}">`);
    }
    if (meta.image) {
        newHtml = newHtml.replace(/<meta property="og:image" content=".*?">/, `<meta property="og:image" content="${meta.image}">`);
        newHtml = newHtml.replace(/<meta name="twitter:image" content=".*?">/, `<meta name="twitter:image" content="${meta.image}">`);
    }
    if (meta.url) {
        newHtml = newHtml.replace(/<meta property="og:url" content=".*?">/, `<meta property="og:url" content="${meta.url}">`);
    }
    if (meta.schema) {
        const schemaString = JSON.stringify(meta.schema).replace(/</g, '\\u003c');
        newHtml = newHtml.replace('</head>', `<script type="application/ld+json">\n${schemaString}\n</script>\n</head>`);
    }
    return newHtml;
}

app.get('*', async (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');
    let meta = { url: `https://okuryazmaz.com${req.originalUrl}` };

    if (req.path === '/alintilar') {
        meta.title = `Kitaplardan İnciler ve Alıntılar - Okuryazmaz`;
        meta.description = `Dünya ve Türk edebiyatının en iyi eserlerinden seçilmiş çarpıcı sözler, alıntılar ve kitap incileri okurların kaleminden Okuryazmaz'da.`;
        meta.schema = {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": meta.title,
            "description": meta.description,
            "url": meta.url
        };
    } else if (req.path.startsWith('/konu/')) {
        const idAndSlug = req.path.split('/')[2];
        if (idAndSlug) {
            const topicId = parseInt(idAndSlug.split('-')[0]);
            try {
                const topic = await new Promise((resolve, reject) => {
                    db.get(`SELECT topics.title, topics.content, topics.book_cover_url, users.username, topics.created_at, topics.updated_at 
                            FROM topics LEFT JOIN users ON topics.user_id = users.id 
                            WHERE topics.id = ? AND IFNULL(topics.is_hidden, 0) = 0`, [topicId], (err, row) => {
                        if (err) reject(err); else resolve(row);
                    });
                });
                
                if (topic) {
                    meta.title = `${topic.title} - Okuryazmaz`;
                    let desc = topic.content.replace(/<[^>]*>?/gm, '').substring(0, 180);
                    meta.description = desc + '...';
                    if (topic.book_cover_url) meta.image = topic.book_cover_url;
                    
                    meta.schema = {
                        "@context": "https://schema.org",
                        "@type": "DiscussionForumPosting",
                        "headline": topic.title,
                        "text": desc,
                        "author": { "@type": "Person", "name": topic.username },
                        "datePublished": new Date(topic.created_at + 'Z').toISOString()
                    };
                }
            } catch(e) { console.error('SSR Konu hatası:', e); }
        }
    } else if (req.path.startsWith('/kitap/')) {
        const keyAndSlug = req.path.split('/')[2];
        if (keyAndSlug) {
            const bookKey = keyAndSlug.split('-')[0];
            try {
                const resApi = await axios.get(`https://openlibrary.org/works/${bookKey}.json`, { timeout: 8000 });
                if (resApi.data && resApi.data.title) {
                    const bookTitle = resApi.data.title;
                    meta.title = `${bookTitle} İnceleme ve Tartışma - Okuryazmaz`;
                    let desc = `${bookTitle} adlı eser hakkında Türkiye'nin en aktif okur topluluğunda yapılan incelemeler, yorumlar ve tartışmalar.`;
                    
                    if (resApi.data.description) {
                        let rawDesc = typeof resApi.data.description === 'object' ? resApi.data.description.value : resApi.data.description;
                        if (rawDesc) desc = rawDesc.substring(0, 180) + '...';
                    }
                    meta.description = desc;
                    if (resApi.data.covers && resApi.data.covers.length > 0) {
                        meta.image = `https://covers.openlibrary.org/b/id/${resApi.data.covers[0]}-L.jpg`;
                    }
                    
                    meta.schema = {
                        "@context": "https://schema.org",
                        "@type": "Book",
                        "name": bookTitle,
                        "description": desc,
                        "url": meta.url
                    };
                }
            } catch(e) { console.error('SSR Kitap hatası:', e.message); }
        }
    } else if (req.path.startsWith('/yazar/')) {
        const keyAndSlug = decodeURIComponent(req.path.split('/')[2] || '');
        if (keyAndSlug) {
            try {
                let authorKey = keyAndSlug.startsWith('OL') ? keyAndSlug.split('-')[0] : null;
                
                // Eğer OL key değilse (düz isim gelmiş), önce arama yap
                if (!authorKey) {
                    const searchRes = await axios.get(`https://openlibrary.org/search/authors.json?q=${encodeURIComponent(keyAndSlug)}&limit=1`, { timeout: 8000 });
                    if (searchRes.data && searchRes.data.docs && searchRes.data.docs.length > 0) {
                        authorKey = searchRes.data.docs[0].key.replace('/authors/', '');
                    }
                }
                
                if (authorKey) {
                    const resApi = await axios.get(`https://openlibrary.org/authors/${authorKey}.json`, { timeout: 8000 });
                    if (resApi.data && resApi.data.name) {
                        const authorName = resApi.data.name;
                        meta.title = `${authorName} - Hayatı, Eserleri ve Alıntıları | Okuryazmaz`;
                        meta.description = `${authorName} kimdir? Yazarın hayatı, biyografisi, eserleri, kitapları ve en çarpıcı alıntıları Türkiye'nin edebi kütüphanesinde.`;
                        
                        if (resApi.data.photos && resApi.data.photos.length > 0) {
                            meta.image = `https://covers.openlibrary.org/a/id/${resApi.data.photos[0]}-L.jpg`;
                        }
                        
                        meta.schema = {
                            "@context": "https://schema.org",
                            "@type": "Person",
                            "name": authorName,
                            "description": meta.description,
                            "url": meta.url
                        };
                    }
                }
            } catch(e) { console.error('SSR Yazar hatası:', e.message); }
        }
    } else if (req.path.startsWith('/alintilar/yazar/')) {
        const slug = req.path.split('/')[3];
        const rawName = decodeURIComponent(slug).replace(/-/g, ' '); // Basit geri dönüştürme
        meta.title = `${rawName} Alıntıları, Sözleri ve İncileri - Okuryazmaz`;
        meta.description = `${rawName} eserlerinden seçilmiş en güzel alıntılar, unutulmaz sözler ve edebi inciler.`;
    } else if (req.path.startsWith('/alintilar/kitap/')) {
        const slug = req.path.split('/')[3];
        meta.title = `Kitap Alıntıları ve Sözleri - Okuryazmaz`;
        meta.description = `Bu kitaptan seçilmiş unutulmaz alıntılar ve sözler.`;
    }

    res.send(injectMetaTags(html, meta));
});

const botManager = require('./ai/botManager');

app.listen(PORT, async () => {
    console.log(` Okuryazmaz Forum sunucusu başarıyla başlatıldı! -> http://localhost:${PORT}`);
    await botManager.initializeAIBots();
    botManager.startAutonomousLoop();
});
