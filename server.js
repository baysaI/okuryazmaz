require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const forumRoutes = require('./routes/forum');
const profileRoutes = require('./routes/profile');
const adminRoutes = require('./routes/admin');
const reportRoutes = require('./routes/report');
const notificationRoutes = require('./routes/notification');

const app = express();
const PORT = process.env.PORT || 3000;
const db = require('./database/db');


app.set('trust proxy', 1);


app.use(helmet({
    contentSecurityPolicy: false,
}));


const allowedOrigins = ['https://okuryazmaz.com', 'http://localhost:3000', 'http://localhost:5000', 'http://127.0.0.1:3000', 'http://127.0.0.1:5000'];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('CORS policy does not allow access from this origin.'));
        }
    },
    credentials: true
}));

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


const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 150, 
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Çok fazla istek gönderdiniz. Lütfen biraz bekleyin.' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 15, 
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Güvenlik nedeniyle çok fazla deneme yaptınız. Lütfen 15 dakika sonra tekrar deneyin.' }
});


app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);


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


app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'Bu API yolu bulunamadı.' });
});


app.locals.cachedPopularBooks = [];
const axios = require('axios');


const indexPath = path.join(__dirname, 'public', 'index.html');
let cachedIndexHtml = fs.readFileSync(indexPath, 'utf8');
if (process.env.NODE_ENV !== 'production') {
    fs.watchFile(indexPath, { interval: 2000 }, () => {
        cachedIndexHtml = fs.readFileSync(indexPath, 'utf8');
        console.log('[DEV] index.html yeniden yüklendi.');
    });
}


function escapeXml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}


const SITEMAP_CACHE_PATH = path.join(__dirname, 'database', 'sitemap_cache.json');
const SITEMAP_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; 

function loadSitemapCache() {
    try {
        if (fs.existsSync(SITEMAP_CACHE_PATH)) {
            const data = JSON.parse(fs.readFileSync(SITEMAP_CACHE_PATH, 'utf8'));
            if (Date.now() - data.timestamp < SITEMAP_CACHE_MAX_AGE) {
                app.locals.cachedPopularBooks = data.books || [];
                cachedPopularAuthors = data.authors || [];
                console.log(`[SEO] Cache'den yüklendi: ${data.books.length} kitap, ${data.authors.length} yazar`);
                return true;
            }
        }
    } catch(e) { console.error('[SEO] Cache okuma hatası:', e.message); }
    return false;
}

function saveSitemapCache() {
    try {
        const data = {
            timestamp: Date.now(),
            books: app.locals.cachedPopularBooks,
            authors: cachedPopularAuthors
        };
        fs.writeFileSync(SITEMAP_CACHE_PATH, JSON.stringify(data));
        console.log('[SEO] Cache dosyaya kaydedildi.');
    } catch(e) { console.error('[SEO] Cache yazma hatası:', e.message); }
}

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
    
    
    const queries = [
        { q: 'language:tur', limit: 1000 }, 
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
                        if (!app.locals.cachedPopularBooks.find(b => b.key === key)) {
                            app.locals.cachedPopularBooks.push({ 
                                key, 
                                slug: slugify(w.title),
                                title: w.title,
                                cover_i: w.cover_i || null,
                                author_name: w.author_name ? w.author_name[0] : 'Bilinmeyen Yazar'
                            });
                        }
                    }
                });
                console.log(`[SEO] Hedef Sorgu Eklendi: ${item.q} | Toplam Kitap: ${app.locals.cachedPopularBooks.length}`);
            }
        } catch(e) {
            console.error(`[SEO] ${item.q} çekilirken hata:`, e.message);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    console.log(`[SEO] MÜKEMMEL! Türk okur kitlesine özel toplam ${app.locals.cachedPopularBooks.length} kitap sitemap için belleğe alındı.`);
}


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


if (!loadSitemapCache()) {
    (async () => {
        await fetchPopularBooksForSitemap();
        await fetchPopularAuthorsForSitemap();
        saveSitemapCache();
    })();
} else {
    console.log('[SEO] Sitemap cache güncel, OpenLibrary çağrısı atlandı. Sunucu hızlı başladı.');
}



function dbAllAsync(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

app.get('/sitemap.xml', async (req, res) => {
    res.type('application/xml');
    try {
        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://okuryazmaz.com/</loc><priority>1.0</priority></url>
    <url><loc>https://okuryazmaz.com/kategori/1-romanlar-ve-kurgu</loc><priority>0.8</priority></url>
    <url><loc>https://okuryazmaz.com/kategori/2-bilim-kurgu-ve-fantastik</loc><priority>0.8</priority></url>
`;

        
        const topics = await dbAllAsync("SELECT id, title, updated_at FROM topics WHERE IFNULL(is_hidden, 0) = 0");
        topics.forEach(t => {
            const slug = slugify(t.title) ? '-' + slugify(t.title) : '';
            const date = t.updated_at ? new Date(t.updated_at + 'Z').toISOString() : new Date().toISOString();
            xml += `    <url><loc>https://okuryazmaz.com/konu/${t.id}${slug}</loc><lastmod>${date}</lastmod><priority>0.9</priority></url>\n`;
        });

        
        const dbBooks = await dbAllAsync("SELECT DISTINCT book_key, book_reference_title FROM topics WHERE book_key IS NOT NULL");
        let combinedBooks = [...app.locals.cachedPopularBooks];
        dbBooks.forEach(b => {
            const key = b.book_key.replace('/works/', '');
            if (!combinedBooks.find(cb => cb.key === key)) {
                combinedBooks.push({ key, slug: slugify(b.book_reference_title) });
            }
        });
        combinedBooks.forEach(book => {
            xml += `    <url><loc>https://okuryazmaz.com/kitap/${escapeXml(book.key)}-${escapeXml(book.slug)}</loc><priority>0.7</priority></url>\n`;
        });

        
        const authors = await dbAllAsync("SELECT DISTINCT book_author FROM quotes WHERE book_author IS NOT NULL AND book_author != ''");
        authors.forEach(a => {
            const authorSlug = slugify(a.book_author);
            xml += `    <url><loc>https://okuryazmaz.com/alintilar/yazar/${escapeXml(authorSlug)}</loc><priority>0.6</priority></url>\n`;
        });

        
        cachedPopularAuthors.forEach(author => {
            const cleanKey = author.key.replace('/authors/', '');
            xml += `    <url><loc>https://okuryazmaz.com/yazar/${escapeXml(cleanKey)}-${escapeXml(author.slug)}</loc><priority>0.8</priority></url>\n`;
        });

        xml += `</urlset>`;
        res.send(xml);
    } catch(e) {
        console.error('[SEO] Sitemap oluşturma hatası:', e.message);
        res.status(500).send('Sitemap oluşturulurken hata oluştu.');
    }
});

app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(`User-agent: *\nAllow: /\nSitemap: https://okuryazmaz.com/sitemap.xml\n`);
});


function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


function injectMetaTags(html, meta) {
    let newHtml = html;
    
    const safeTitle = escapeHtml(meta.title);
    const safeDescription = escapeHtml(meta.description);
    const safeImage = escapeHtml(meta.image);
    const safeUrl = escapeHtml(meta.url);

    if (meta.title) {
        newHtml = newHtml.replace(/<title>.*?<\/title>/, `<title>${safeTitle}</title>`);
        newHtml = newHtml.replace(/<meta property="og:title" content=".*?">/, `<meta property="og:title" content="${safeTitle}">`);
        newHtml = newHtml.replace(/<meta name="twitter:title" content=".*?">/, `<meta name="twitter:title" content="${safeTitle}">`);
    }
    if (meta.description) {
        newHtml = newHtml.replace(/<meta name="description" content=".*?">/, `<meta name="description" content="${safeDescription}">`);
        newHtml = newHtml.replace(/<meta property="og:description" content=".*?">/, `<meta property="og:description" content="${safeDescription}">`);
        newHtml = newHtml.replace(/<meta name="twitter:description" content=".*?">/, `<meta name="twitter:description" content="${safeDescription}">`);
    }
    if (meta.image) {
        newHtml = newHtml.replace(/<meta property="og:image" content=".*?">/, `<meta property="og:image" content="${safeImage}">`);
        newHtml = newHtml.replace(/<meta name="twitter:image" content=".*?">/, `<meta name="twitter:image" content="${safeImage}">`);
    }
    if (meta.url) {
        newHtml = newHtml.replace(/<meta property="og:url" content=".*?">/, `<meta property="og:url" content="${safeUrl}">`);
        
        if (newHtml.includes('rel="canonical"')) {
            newHtml = newHtml.replace(/<link rel="canonical" href=".*?">/, `<link rel="canonical" href="${safeUrl}">`);
        } else {
            newHtml = newHtml.replace('</head>', `    <link rel="canonical" href="${safeUrl}">\n</head>`);
        }
    }
    if (meta.schema) {
        const schemaString = JSON.stringify(meta.schema).replace(/</g, '\\u003c');
        newHtml = newHtml.replace('</head>', `<script type="application/ld+json">\n${schemaString}\n</script>\n</head>`);
    }
    return newHtml;
}

app.get('*', async (req, res) => {
    let html = cachedIndexHtml;
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
        const rawName = decodeURIComponent(slug).replace(/-/g, ' '); 
        meta.title = `${rawName} Alıntıları, Sözleri ve İncileri - Okuryazmaz`;
        meta.description = `${rawName} eserlerinden seçilmiş en güzel alıntılar, unutulmaz sözler ve edebi inciler.`;
    } else if (req.path.startsWith('/alintilar/kitap/')) {
        const slug = req.path.split('/')[3];
        meta.title = `Kitap Alıntıları ve Sözleri - Okuryazmaz`;
        meta.description = `Bu kitaptan seçilmiş unutulmaz alıntılar ve sözler.`;
    }

    res.send(injectMetaTags(html, meta));
});


app.use((err, req, res, next) => {
    if (err instanceof URIError) {
        console.warn(`[WARN] Geçersiz URI isteği engellendi: ${req.url}`);
        return res.status(400).send('Geçersiz URI / Bad Request');
    }
    console.error('[HATA] Sunucu içi beklenmeyen hata:', err);
    res.status(500).send('Sunucu içi bir hata oluştu.');
});

const botManager = require('./ai/botManager');


app.listen(PORT, async () => {
    console.log(` Okuryazmaz Forum sunucusu başarıyla başlatıldı! -> http://localhost:${PORT}`);
    await botManager.initializeAIBots();
    botManager.startAutonomousLoop();
});
