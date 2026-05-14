const app = {
    state: {
        user: null,
        token: null,
        currentCategoryId: null,
        currentTopicId: null,
        viewingProfileId: null,
        categories: []
    },

    init: async () => {
        const storedToken = localStorage.getItem('okuryazmaz_token');
        const storedUser = localStorage.getItem('okuryazmaz_user');
        if (storedToken && storedUser) {
            app.state.token = storedToken;
            app.state.user = JSON.parse(storedUser);
            app.loadNotifications();
        }
        app.renderAuthSection();
        await app.loadCategories();

        window.addEventListener('popstate', (e) => {
            app.handleRoute(window.location.pathname, false);
        });
        app.handleRoute(window.location.pathname, false);
    },

    handleRoute: (path, push = true) => {
        if (push) window.history.pushState({}, '', path);

        if (path === '/' || path === '/index.html') {
            app._showHomeInternal();
        } else if (path === '/alintilar') {
            app.showQuotes();
        } else if (path.startsWith('/alintilar/kitap/')) {
            const bookSlug = path.split('/')[3];
            app.showQuotesByBook(bookSlug);
        } else if (path.startsWith('/yazar/')) {
            const keyAndSlug = decodeURIComponent(path.split('/')[2]);
            let authorKey = keyAndSlug;
            if (keyAndSlug.startsWith('OL')) {
                authorKey = keyAndSlug.split('-')[0];
            }
            app._loadDynamicAuthorInternal(authorKey);
        } else if (path.startsWith('/kategori/')) {
            const idAndSlug = path.split('/')[2];
            app._showTopicsInternal(parseInt(idAndSlug));
        } else if (path.startsWith('/konu/')) {
            const idAndSlug = path.split('/')[2];
            app._loadTopicDetailInternal(parseInt(idAndSlug));
        } else if (path.startsWith('/kitap/')) {
            const keyAndSlug = path.split('/')[2];
            const bookKey = keyAndSlug.split('-')[0];
            app._loadDynamicBookInternal(bookKey);
        } else if (path.startsWith('/profil/')) {
            const username = path.split('/')[2];
            app._showProfileInternal(decodeURIComponent(username));
        } else if (path === '/admin') {
            app._showAdminPanelInternal();
        } else {
            app._showHomeInternal();
        }
    },

    slugify: (text) => {
        if (!text) return '';
        const trMap = { 'çÇ': 'c', 'ğĞ': 'g', 'şŞ': 's', 'üÜ': 'u', 'ıİ': 'i', 'öÖ': 'o' };
        for (let key in trMap) {
            text = text.replace(new RegExp('[' + key + ']', 'g'), trMap[key]);
        }
        return text.toString().toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^\w\-]+/g, '')
            .replace(/\-\-+/g, '-')
            .replace(/^-+/, '')
            .replace(/-+$/, '');
    },

    // Merkezi kitap arama: title + q paralel arama, dedupe, yabancı başlıkları Türkçeye çevir
    async searchBooks(query, limit = 5) {
        const fields = 'key,title,author_name,cover_i,edition_count,first_publish_year';
        
        // İki aramayı paralel yap: biri başlığa göre (kesin), biri genel (geniş)
        const [titleRes, qRes] = await Promise.all([
            fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&limit=${limit * 2}&fields=${fields}`).then(r => r.json()).catch(() => ({docs:[]})),
            fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${limit * 2}&fields=${fields}`).then(r => r.json()).catch(() => ({docs:[]}))
        ]);
        
        // Başlık sonuçları önce, geniş sonuçlar sonra
        const allDocs = [...(titleRes.docs || []), ...(qRes.docs || [])];
        if (allDocs.length === 0) return [];
        
        // Başlığı normalize et
        const normalize = (t) => (t || '').toLowerCase()
            .replace(/[ıİ]/g, 'i').replace(/[öÖ]/g, 'o').replace(/[üÜ]/g, 'u')
            .replace(/[çÇ]/g, 'c').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
            .replace(/[^a-z0-9]/g, '');
        
        // Tekilleştir, en çok baskısı olanı tut, sırayı koru (title sonuçları önce)
        const seen = new Map();
        allDocs.forEach(book => {
            const author = book.author_name ? book.author_name[0] : '';
            const dedupeKey = normalize(book.title) + '|' + normalize(author);
            const existing = seen.get(dedupeKey);
            if (!existing || (book.edition_count || 0) > (existing.edition_count || 0)) {
                seen.set(dedupeKey, book);
            }
        });
        
        const results = Array.from(seen.values()).slice(0, limit);
        
        // Sadece yabancı dildeki başlıkları Türkçeye çevir (Türkçe karakterler varsa zaten Türkçe)
        const hasTurkish = (t) => /[çÇğĞıİöÖşŞüÜ]/.test(t);
        const toTranslate = [];
        const translateIndices = [];
        
        results.forEach((book, i) => {
            book.title_original = book.title;
            if (!hasTurkish(book.title) && /^[a-zA-Z\s\-':,\.!?\d]+$/.test(book.title)) {
                toTranslate.push(book.title);
                translateIndices.push(i);
            }
        });
        
        if (toTranslate.length > 0) {
            try {
                const joined = toTranslate.join(' ||| ');
                const translated = await app.translateText(joined);
                const parts = translated.split(/\s*\|\|\|\s*/);
                translateIndices.forEach((idx, j) => {
                    if (parts[j] && parts[j].trim()) {
                        results[idx].title = parts[j].trim();
                    }
                });
            } catch(e) { /* çeviri başarısız → orijinal başlık kalır */ }
        }
        
        return results;
    },

    translateText: async (text) => {
        if (!text || text.trim() === '') return text;
        const cacheKey = 'tr_' + encodeURIComponent(text).substring(0, 100);
        if (sessionStorage.getItem(cacheKey)) return sessionStorage.getItem(cacheKey);
        
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t&q=${encodeURIComponent(text)}`;
            const res = await fetch(url);
            const data = await res.json();
            const translated = data[0].map(item => item[0]).join('');
            sessionStorage.setItem(cacheKey, translated);
            return translated;
        } catch (e) {
            console.error('Çeviri hatası:', e);
            return text; // Hata olursa orijinal metni döndür
        }
    },

    hideAllViews: () => {
        document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    },
    showHome: () => { app.handleRoute('/'); },
    _showHomeInternal: () => {
        app.hideAllViews();
        const hv = document.getElementById('view-home');
        if (hv) hv.classList.remove('hidden');
        document.querySelectorAll('.cat-shelf-item').forEach(c => c.classList.remove('active-cat'));
        const homeBtn = document.getElementById('nav-home-btn');
        if (homeBtn) homeBtn.classList.add('active-cat');
        app.state.currentCategoryId = null;
        app.loadHomepageContent();
    },
    showTopics: (categoryId, title = '') => {
        const slug = title ? `-${app.slugify(title)}` : '';
        app.handleRoute(`/kategori/${categoryId}${slug}`);
    },
    _showTopicsInternal: (categoryId) => {
        app.state.currentCategoryId = categoryId;
        app.hideAllViews();
        const sidebar = document.getElementById('main-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (sidebar) sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.add('hidden');

        document.querySelectorAll('.cat-shelf-item').forEach(c => c.classList.remove('active-cat'));
        const clk = document.getElementById(`cat-item-${categoryId}`);
        if (clk) clk.classList.add('active-cat');

        document.getElementById('view-topics').classList.remove('hidden');

        const cat = app.state.categories.find(c => c.id == categoryId);
        const categoryName = cat ? cat.title : 'Kategori';

        // URL'yi tam ve SEO uyumlu slug ile güncelle
        if (cat) window.history.replaceState({}, '', `/kategori/${categoryId}-${app.slugify(cat.title)}`);

        document.getElementById('cat-title-display').innerHTML = `<i class="fa-solid fa-bookmark" style="font-size:0.8em"></i> ${categoryName}`;
        app.loadTopics(categoryId);
    },
    goBackToTopics: () => {
        if (app.state.currentCategoryId) {
            app.handleRoute(`/kategori/${app.state.currentCategoryId}`);
        } else {
            app.handleRoute('/');
        }
    },

    showModal: (id) => document.getElementById(id).classList.remove('hidden'),
    closeModal: (id) => document.getElementById(id).classList.add('hidden'),

    toggleNotifications() {
        const d = document.getElementById('notif-dropdown');
        d.classList.toggle('hidden');
        if (!d.classList.contains('hidden')) app.loadNotifications();
    },

    async loadNotifications() {
        if (!app.state.user) return;
        try {
            const notifs = await app.apiCall('/notification');
            const unreadCount = notifs.filter(n => !n.is_read).length;
            const badge = document.getElementById('notif-badge');

            if (unreadCount > 0) {
                badge.innerText = unreadCount;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }

            document.getElementById('notif-list').innerHTML = notifs.length === 0
                ? '<div class="notif-item">Bildirimlerin rafları şimdilik boş.</div>'
                : notifs.map(n => `
                    <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="app.handleNotifClick(${n.id}, '${n.type}', ${n.source_id})">
                        ${n.message}
                        <div class="notif-time">${new Date(n.created_at + "Z").toLocaleString('tr-TR')}</div>
                    </div>
                `).join('');
        } catch (e) { }
    },

    async handleNotifClick(id, type, sourceId) {
        if (type === 'reply' || type === 'admin_alert') {
            app.loadTopicDetail(sourceId);
        }
        app.toggleNotifications();

    },

    async markAllNotificationsRead() {
        try {
            await app.apiCall('/notification/mark-read', 'PUT');
            app.loadNotifications();
        } catch (e) { }
    },

    switchAuthTab: (tab) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(f => f.classList.add('hidden'));
        document.getElementById(`tab-${tab}`).classList.add('active');
        document.getElementById(`${tab}-form`).classList.remove('hidden');
    },
    toast: (message) => {
        const container = document.getElementById('toast-container');
        const t = document.createElement('div');
        t.className = 'toast';
        t.innerText = message;
        container.appendChild(t);
        setTimeout(() => t.remove(), 4000);
    },

    async apiCall(endpoint, method = 'GET', body = null) {
        const headers = {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
        };
        if (app.state.token) headers['Authorization'] = `Bearer ${app.state.token}`;

        // Cache-busting: URL'e timestamp ekle
        const separator = endpoint.includes('?') ? '&' : '?';
        const cacheBuster = `${separator}_t=${Date.now()}`;

        try {
            const res = await fetch(`/api${endpoint}${cacheBuster}`, { method, headers, body: body ? JSON.stringify(body) : null });
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                throw new Error('Sunucu geçici olarak meşgul, lütfen tekrar deneyin.');
            }
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Bilinmeyen Hata');
            return data;
        } catch (error) { throw error; }
    },

    async loadCategories() {
        const container = document.getElementById('categories-sidebar-list');
        try {
            const data = await app.apiCall('/forum/categories');
            app.state.categories = data;
            container.innerHTML = data.map(c => `
                <div class="cat-shelf-item" id="cat-item-${c.id}" onclick="app.showTopics(${c.id}, '${c.title.replace(/'/g, "\\'")}')">
                    ${c.title}
                </div>
            `).join('');
        } catch (e) { app.toast(e.message); }
    },

    async loadTopics(catId) {
        const container = document.getElementById('topics-container');
        container.innerHTML = '<p style="color:var(--text-secondary)">Zihin tozları silkeleniyor...</p>';
        try {
            const data = await app.apiCall(`/forum/categories/${catId}/topics`);
            if (data.length === 0) {
                container.innerHTML = '<p>Bu raflar şimdilik boş. İlk eseri sen bırakabilirsin.</p>';
                return;
            }
            container.innerHTML = data.map(t => {
                const ava = t.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${t.username}&backgroundColor=1E1C1A&textColor=C5A059`;
                const contentSnippet = t.content.replace(/<[^>]*>?/gm, '').substring(0, 85) + '...';
                const replyCount = t.reply_count || 0;
                return `
                <div class="topic-row" onclick="app.loadTopicDetail(${t.id}, '${t.title.replace(/'/g, "\\'")}')" style="align-items:center;">
                    <div style="width: 50px; height: 60px; border: 1px solid var(--glass-border); border-radius:6px; display:flex; align-items:center; justify-content:center; color: var(--accent-gold); background: rgba(197,160,89,0.05); flex-shrink:0;">
                         <i class="fa-solid fa-book-open" style="font-size: 1.4rem;"></i>
                    </div>
                    <div style="flex:1; overflow:hidden;">
                        <div class="topic-title" style="font-weight:600; font-size:1.3rem;">${t.is_hidden ? '<span style="color:#777; font-size:0.8em;">[GİZLİ]</span> ' : ''}${t.title}</div>
                        <div style="color:var(--text-secondary); font-size:0.95rem; margin-bottom:8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; font-family:'Inter';">${contentSnippet}</div>
                        <div class="topic-meta">
                            <img src="${ava}" class="avatar-sm" alt="avatar" onclick="event.stopPropagation(); app.showProfile('${t.username}')" style="cursor:pointer; width:22px; height:22px; border:none; box-shadow:none;">
                            <span class="clickable-user" onclick="event.stopPropagation(); app.showProfile('${t.username}')" style="font-size:0.95rem; font-family:'Inter'; font-weight:500;">${t.username}</span> 
                            <span style="opacity:0.3; margin:0 5px;">|</span>
                            <span>${t.views || 0} okuma</span>
                            <span style="opacity:0.3; margin:0 5px;">|</span>
                            <span><i class="fa-regular fa-comment"></i> ${replyCount} yorum</span>
                        </div>
                    </div>
                </div>
            `}).join('');
        } catch (e) { app.toast(e.message); }
    },

    loadTopicDetail(topicId, title = '') {
        const slug = title ? `-${app.slugify(title)}` : '';
        app.handleRoute(`/konu/${topicId}${slug}`);
    },
    async _loadTopicDetailInternal(topicId) {
        app.state.currentTopicId = topicId;
        app.hideAllViews();
        document.getElementById('view-topic-detail').classList.remove('hidden');
        document.getElementById('topic-main-content').innerHTML = '<div class="loading-pulse" style="text-align:center; padding:3rem;">Satırlar okunuyor...</div>';
        document.getElementById('book-profile-card').innerHTML = "";

        try {
            const { topic, posts } = await app.apiCall(`/forum/topics/${topicId}`);

            // Konu yüklendiğinde URL'yi tam slug ile güncelle
            window.history.replaceState({}, '', `/konu/${topicId}-${app.slugify(topic.title)}`);

            app.state.loadedTopic = topic;
            app.state.loadedPosts = posts;

            const tAva = topic.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${topic.username}&backgroundColor=2A2826&textColor=D4AF37`;

            let parsedContent = topic.content.replace(/\\n/g, '<br>');
            parsedContent = parsedContent.replace(/"([^"]*)"/g, '<blockquote>"$1"</blockquote>');

            document.getElementById('topic-main-content').innerHTML = `
                <h2>${topic.is_hidden ? '<span style="color:#777; font-size:0.8em;">[GİZLİ]</span> ' : ''}${topic.title}</h2>
                <div class="topic-author-bar">
                    <img src="${tAva}" class="avatar-sm" alt="avatar" onclick="app.showProfile('${topic.username}')" style="cursor:pointer;">
                    <div style="flex:1;">
                        <span class="clickable-user" onclick="app.showProfile('${topic.username}')">${topic.username}</span> • <span style="font-size:0.85rem;">${new Date(topic.created_at + "Z").toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </div>
                    <div style="display:flex; gap:10px; align-items:center;">
                        ${app.state.user ? `<span class="edit-tag" onclick="app.showReportModal('topic', ${topic.id})" style="margin:0;"><i class="fa-solid fa-flag"></i> Rapor Et</span>` : ''}
                        ${app.state.user && app.state.user.is_admin ? `
                            <button class="btn-primary" style="padding: 4px 10px; font-size:0.85rem; background:transparent; border:1px solid var(--glass-border); color:var(--text-secondary);" onclick="app.showEditTopicModal(${topic.id})"><i class="fa-solid fa-pen"></i></button>
                            <button class="btn-primary" style="padding: 4px 10px; font-size:0.85rem; background:transparent; border:1px solid #777; color:#ccc;" onclick="app.toggleHideTopic(${topic.id}, ${topic.is_hidden || 0})"><i class="fa-solid ${topic.is_hidden ? 'fa-eye' : 'fa-eye-slash'}"></i></button>
                            <button class="btn-primary" style="padding: 4px 10px; font-size:0.85rem; background:transparent; border:1px solid #c0392b; color:#c0392b;" onclick="app.deleteTopic(${topic.id})"><i class="fa-solid fa-trash"></i></button>
                        ` : ''}
                    </div>
                </div>
                <div class="post-content">${parsedContent}</div>
            `;

            if (topic.book_reference_title) {
                const cover = topic.book_cover_url && topic.book_cover_url !== 'null' ? `<img src="${topic.book_cover_url}" class="book-cover">` : `<div class="book-cover-placeholder"><i class="fa-solid fa-book" style="font-size:2rem; margin-bottom:10px;"></i><br>Kapak Bulunamadı</div>`;
                document.getElementById('book-profile-card').innerHTML = `
                <div class="book-profile">
                    ${cover}
                    <div class="book-info">
                        <h4>${topic.book_reference_title}</h4>
                        <p>Yazar: <strong>${topic.book_author || 'Bilinmiyor'}</strong></p>
                        ${topic.book_pages && topic.book_pages !== '-' ? `<p>Sayfa: <strong>${topic.book_pages}</strong></p>` : ''}
                        ${topic.book_publish_date && topic.book_publish_date !== '-' ? `<p>İlk Çıkış: <strong>${topic.book_publish_date}</strong></p>` : ''}
                    </div>
                </div>`;
            }

            const postsHtml = posts.map(p => {
                const pAva = p.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${p.username}&backgroundColor=2A2826&textColor=D4AF37`;
                let pContent = p.content.replace(/\\n/g, '<br>');
                pContent = pContent.replace(/"([^"]*)"/g, '<blockquote>"$1"</blockquote>');
                return `
                <div class="post-card">
                    <img src="${pAva}" class="avatar-sm" style="width: 45px; height: 45px; cursor:pointer;" alt="avatar" onclick="app.showProfile('${p.username}')">
                    <div class="post-card-body">
                        <div style="display:flex; justify-content:space-between; align-items:start;">
                            <div>
                                <div class="post-author clickable-user" onclick="app.showProfile('${p.username}')">${p.username}</div>
                                <div class="post-header">
                                    ${new Date(p.created_at + "Z").toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                                    ${p.updated_at ? `<span class="edit-tag" title="Düzenlendi" onclick="app.showPostHistory(${p.id})"> (Düzenlendi)</span>` : ''}
                                </div>
                            </div>
                            <div style="display:flex; gap:10px; align-items:center;">
                                ${app.state.user ? `<span class="edit-tag" onclick="app.showReportModal('post', ${p.id})"><i class="fa-solid fa-flag"></i></span>` : ''}
                                ${(app.state.user && (app.state.user.id === p.user_id)) || (app.state.user && app.state.user.is_admin) ? `
                                    <button class="btn-primary" style="padding: 4px 8px; font-size:0.75rem; background:transparent; border:1px solid var(--accent-gold); color:var(--accent-gold);" onclick="app.showEditPostModal(${p.id})"><i class="fa-solid fa-pen"></i></button>
                                ` : ''}
                                ${app.state.user && app.state.user.is_admin ? `
                                    <button class="btn-primary" style="padding: 4px 8px; font-size:0.75rem; background:transparent; border:1px solid #c0392b; color:#c0392b;" onclick="app.deletePost(${p.id})"><i class="fa-solid fa-trash"></i></button>
                                ` : ''}
                            </div>
                        </div>
                        <div class="post-content" style="font-size:1rem; margin-top:5px;">${pContent}</div>
                    </div>
                </div>
            `}).join('');
            document.getElementById('replies-container').innerHTML = postsHtml;

            app.renderReplyBox();

        } catch (e) { app.toast(e.message); }
    },

    async _loadDynamicBookInternal(bookKey) {
        app.hideAllViews();
        document.getElementById('view-dynamic-book').classList.remove('hidden');

        document.getElementById('dynamic-book-cover-container').innerHTML = '<div class="loading-pulse" style="text-align:center; padding:1rem;">Kütüphane arşivleri aranıyor...</div>';
        document.getElementById('dynamic-book-title').innerHTML = '';
        document.getElementById('dynamic-book-meta').innerHTML = '';
        document.getElementById('dynamic-book-desc').innerHTML = '';
        document.getElementById('dynamic-book-related-topics').innerHTML = '<div class="loading-pulse">Konular yükleniyor...</div>';

        try {
            let book = null;
            const cacheKey = 'ol_book_' + bookKey;
            if (sessionStorage.getItem(cacheKey)) {
                book = JSON.parse(sessionStorage.getItem(cacheKey));
            } else {
                const res = await fetch(`https://openlibrary.org/works/${bookKey}.json`);
                if (!res.ok) throw new Error('Kitap bulunamadı.');
                book = await res.json();
                sessionStorage.setItem(cacheKey, JSON.stringify(book));
            }

            // Set URL with proper slug
            window.history.replaceState({}, '', `/kitap/${bookKey}-${app.slugify(book.title)}`);
            document.title = `${book.title} - Okuryazmaz`;

            const coverId = book.covers ? book.covers[0] : null;
            const coverHtml = coverId
                ? `<img src="https://covers.openlibrary.org/b/id/${coverId}-L.jpg" style="max-width:250px; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.5);">`
                : `<div style="width:200px; height:300px; margin:0 auto; background:rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:center; border-radius:8px;"><i class="fa-solid fa-book" style="font-size:3rem; color:var(--text-secondary);"></i></div>`;

            document.getElementById('dynamic-book-cover-container').innerHTML = coverHtml;
            document.getElementById('dynamic-book-title').innerText = book.title;

            let desc = book.description;
            if (typeof desc === 'object') desc = desc.value;

            let finalDesc = 'Bu kitap hakkında henüz resmi bir açıklama bulunmuyor.';
            if (desc) {
                const shortDesc = desc.substring(0, 800) + (desc.length > 800 ? '...' : '');
                document.getElementById('dynamic-book-desc').innerHTML = '<i class="fa-solid fa-language" style="color:var(--accent-gold); margin-right:5px;"></i> Eserin tozlarına üflüyoruz...';
                finalDesc = await app.translateText(shortDesc);
            }
            document.getElementById('dynamic-book-desc').innerText = finalDesc;

            app.loadBookRatings(bookKey);

            // Start topic button action
            const btnStart = document.getElementById('btn-dynamic-book-start');
            btnStart.onclick = () => {
                if (!app.state.user) return app.toast('Önce giriş yapmalısınız.');
                app.showNewTopicModal();
                setTimeout(() => {
                    const ti = document.getElementById('new-topic-title');
                    const bq = document.getElementById('new-topic-book');
                    if (ti) ti.value = `${book.title}: `;
                    if (bq) bq.value = book.title;
                }, 300);
            };

            // Alıntı bırak button action
            const btnQuote = document.getElementById('btn-dynamic-book-quote');
            if (btnQuote) {
                btnQuote.onclick = () => {
                    app.showNewQuoteModal(book.title, `/works/${bookKey}`);
                };
            }

            // İlgili konuları getir
            try {
                const topics = await app.apiCall(`/forum/books/${bookKey}/topics?title=${encodeURIComponent(book.title)}`);
                const topicsContainer = document.getElementById('dynamic-book-related-topics');

                if (topics.length > 0) {
                    topicsContainer.innerHTML = topics.map(t => {
                        const ava = t.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${t.username}&backgroundColor=1E1C1A&textColor=C5A059`;
                        const replyCount = t.reply_count || 0;
                        return `
                        <div class="topic-row" onclick="app.loadTopicDetail(${t.id}, '${t.title.replace(/'/g, "\\'")}')" style="align-items:center; cursor:pointer;">
                            <div style="flex:1; overflow:hidden;">
                                <div class="topic-title" style="font-weight:600; font-size:1.2rem;">${t.title}</div>
                                <div class="topic-meta">
                                    <img src="${ava}" class="avatar-sm" alt="avatar" style="width:20px; height:20px; border:none;">
                                    <span style="font-size:0.9rem;">${t.username}</span> 
                                    <span style="opacity:0.3; margin:0 5px;">|</span>
                                    <span><i class="fa-regular fa-comment"></i> ${replyCount} yorum</span>
                                </div>
                            </div>
                        </div>
                        `;
                    }).join('');
                } else {
                    topicsContainer.innerHTML = '<p style="color:var(--text-secondary); padding:1rem; text-align:center; border:1px dashed rgba(255,255,255,0.1); border-radius:8px;">Kütüphanemizde bu eseri konu alan bir içerik bulunamadı. Butonu kullanarak ilk yazar siz olun!</p>';
                }
            } catch (e) {
                document.getElementById('dynamic-book-related-topics').innerHTML = '<p style="color:#e74c3c;">Konular yüklenirken hata oluştu.</p>';
            }

            // Kitaba ait alıntıları çek
            try {
                const uid = app.state.user ? app.state.user.id : 0;
                const quotes = await app.apiCall(`/forum/books/${bookKey}/quotes?uid=${uid}&title=${encodeURIComponent(book.title)}`);
                const qContainer = document.getElementById('dynamic-book-quotes');
                if (quotes && quotes.length > 0) {
                    app.renderQuotes(quotes.slice(0, 5), qContainer);
                } else {
                    qContainer.innerHTML = `<p style="color:var(--text-secondary); padding:1rem; text-align:center; border:1px dashed rgba(255,255,255,0.1); border-radius:8px;">Bu eserden henüz alıntı bırakılmamış.</p>
                    <div style="text-align:center; margin-top:15px;"><button class="btn-primary" onclick="document.getElementById('btn-dynamic-book-quote').click()"><i class="fa-solid fa-quote-left"></i> İlk Alıntıyı Sen Bırak</button></div>`;
                }
            } catch(e) {
                document.getElementById('dynamic-book-quotes').innerHTML = '<p style="color:#e74c3c;">Alıntılar yüklenirken hata.</p>';
            }

        } catch (e) {
            document.getElementById('dynamic-book-cover-container').innerHTML = '<p style="color:#e74c3c;">Eser bilgileri kütüphaneden çekilemedi.</p>';
            document.getElementById('dynamic-book-related-topics').innerHTML = '';
        }
    },

    async loadBookRatings(bookKey) {
        try {
            const uid = app.state.user ? app.state.user.id : 0;
            const res = await app.apiCall(`/forum/books/${bookKey}/ratings?uid=${uid}`);
            
            let userRatingHtml = '';
            const rating = res.userRating || 0;
            
            for (let i = 5; i >= 1; i--) {
                const checked = (rating === i) ? 'checked' : '';
                userRatingHtml += `
                    <input type="radio" id="star${i}" name="rating" value="${i}" ${checked} onclick="app.submitBookRating('${bookKey}', ${i})" />
                    <label for="star${i}" title="${i} Yıldız"><i class="fa-solid fa-star"></i></label>
                `;
            }

            const displayAvg = res.avgRating > 0 ? res.avgRating.toFixed(1) : '0.0';
            
            document.getElementById('dynamic-book-rating').innerHTML = `
                <div class="star-rating-container">
                    <div class="star-rating">
                        ${userRatingHtml}
                    </div>
                </div>
                <div class="rating-info">
                    <strong>${displayAvg}</strong> / 5 (${res.totalRatings} Değerlendirme)
                </div>
            `;
        } catch (e) {
            console.error('Puanlar çekilemedi:', e);
        }
    },

    async submitBookRating(bookKey, rating) {
        if (!app.state.user) {
            app.toast('Puan vermek için giriş yapmalısınız.');
            app.showModal('auth-modal');
            app.loadBookRatings(bookKey);
            return;
        }

        try {
            const res = await fetch(`/api/forum/books/${bookKey}/ratings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.state.token}` },
                body: JSON.stringify({ rating })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Puan verilemedi.');
            
            app.toast(data.message || 'Puanınız kaydedildi!');
            app.loadBookRatings(bookKey);
        } catch (e) {
            app.toast(e.message);
        }
    },

    showProfile(username) { app.handleRoute(`/profil/${encodeURIComponent(username)}`); },
    async _showProfileInternal(username) {
        app.hideAllViews();
        document.getElementById('view-profile').classList.remove('hidden');

        try {
            const data = await app.apiCall(`/profile/${username}`);
            const user = data.user;
            document.getElementById('p-avatar').src = user.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${user.username}&backgroundColor=2A2826&textColor=D4AF37`;
            document.getElementById('p-username').innerText = user.username;
            document.getElementById('p-followers').innerHTML = `<i class="fa-solid fa-users" style="margin-right:5px; color:var(--accent-gold);"></i> <span style="border-bottom: 1px dashed var(--accent-gold);">${data.followers} Takipçi</span>`;
            document.getElementById('p-about').innerText = user.about_me || "Yazar henüz diviti eline alıp kendinden bahsetmemiş.";

            app.state.currentFollowersList = data.followersList || [];

            app.state.viewingProfileId = user.id;
            app.state.viewingProfileUsername = user.username;

            // Kendi profiliyse, sunucudan gelen güncel avatar_url'yi state ve localStorage'a yansıt
            if (app.state.user && app.state.user.id === user.id) {
                app.state.user.avatar_url = user.avatar_url;
                localStorage.setItem('okuryazmaz_user', JSON.stringify(app.state.user));
                app.renderAuthSection();
            }

            const btnEdit = document.getElementById('btn-edit-profile');
            const btnFollow = document.getElementById('btn-follow');

            if (app.state.user && app.state.user.id === user.id) {
                btnFollow.classList.add('hidden');
                btnEdit.classList.remove('hidden');
                btnEdit.innerText = "Biyografimi Düzenle";
                document.getElementById('p-about-input').value = user.about_me || '';
                document.getElementById('btn-edit-avatar').classList.remove('hidden');
                document.getElementById('admin-profile-fields').classList.add('hidden');
            } else if (app.state.user && app.state.user.is_admin) {
                btnFollow.classList.remove('hidden');
                btnFollow.innerText = data.isFollowing ? "Takibi Bırak" : "Takip Et";
                btnEdit.classList.remove('hidden');
                btnEdit.innerText = "Yönetici Olarak Düzenle";
                document.getElementById('p-about-input').value = user.about_me || '';
                document.getElementById('btn-edit-avatar').classList.remove('hidden');
                document.getElementById('admin-profile-fields').classList.remove('hidden');


                document.getElementById('p-admin-username').value = '';
                document.getElementById('p-admin-email').value = '';
                document.getElementById('p-admin-password').value = '';
            } else if (app.state.user) {
                btnFollow.classList.remove('hidden');
                btnFollow.innerText = data.isFollowing ? "Takibi Bırak" : "Takip Et";
                btnEdit.classList.add('hidden');
                document.getElementById('btn-edit-avatar').classList.add('hidden');
            } else {
                btnFollow.classList.add('hidden');
                btnEdit.classList.add('hidden');
                document.getElementById('btn-edit-avatar').classList.add('hidden');
            }

            const container = document.getElementById('profile-topics-container');
            if (data.topics.length === 0) {
                container.innerHTML = '<p>Bu yazar henüz platformda bir konu neşretmemiş.</p>';
            } else {
                container.innerHTML = data.topics.map(t => `
                    <div class="topic-row" onclick="app.loadTopicDetail(${t.id})">
                        <div style="flex:1;">
                            <div class="topic-title">${t.title}</div>
                            <div class="topic-meta">Tarih: ${new Date(t.created_at + "Z").toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</div>
                        </div>
                    </div>
                `).join('');
            }

            // ===== ROZETLER =====
            const badgesSection = document.getElementById('profile-badges-section');
            const badgesContainer = document.getElementById('badges-container');
            if (data.badges && data.badges.length > 0) {
                badgesSection.classList.remove('hidden');
                badgesContainer.innerHTML = data.badges.map(b => `
                    <div class="badge-card" title="${b.description}" style="--badge-color: ${b.color};">
                        <div class="badge-icon"><i class="fa-solid ${b.icon}"></i></div>
                        <div class="badge-name">${b.name}</div>
                    </div>
                `).join('');
            } else {
                badgesSection.classList.add('hidden');
            }

            // Admin: Rozet yönetim butonu
            if (app.state.user && app.state.user.is_admin) {
                badgesSection.classList.remove('hidden');
                const existingBtn = badgesContainer.querySelector('.admin-badge-btn');
                if (!existingBtn) {
                    badgesContainer.insertAdjacentHTML('beforeend', `
                        <div class="badge-card admin-badge-btn" style="--badge-color: #c0392b; cursor:pointer; border-style:dashed;" onclick="app.openAdminBadgePanel()">
                            <div class="badge-icon"><i class="fa-solid fa-gear"></i></div>
                            <div class="badge-name">Yönet</div>
                        </div>
                    `);
                }

                // Kullanıcı Yönetimi
                const modSection = document.getElementById('admin-user-mod-section');
                const modBtns = document.getElementById('admin-mod-buttons');
                if (user.id !== app.state.user.id) {
                    modSection.classList.remove('hidden');
                    let btnHtml = '';
                    if (user.is_banned) {
                        btnHtml += `<button class="btn-primary" style="background:#27ae60; border-color:#27ae60;" onclick="app.adminUnbanUser(${user.id})"><i class="fa-solid fa-unlock"></i> Yasağı Kaldır</button>`;
                    } else {
                        btnHtml += `<button class="btn-primary" style="background:#c0392b; border-color:#c0392b;" onclick="app.adminBanUser(${user.id})"><i class="fa-solid fa-ban"></i> Yasakla</button>`;
                    }
                    if (user.is_muted) {
                        btnHtml += `<button class="btn-primary" style="background:#2980b9; border-color:#2980b9;" onclick="app.adminUnmuteUser(${user.id})"><i class="fa-solid fa-volume-high"></i> Susturmayı Kaldır</button>`;
                    } else {
                        btnHtml += `<button class="btn-primary" style="background:#f39c12; border-color:#f39c12;" onclick="app.adminMuteUser(${user.id})"><i class="fa-solid fa-volume-xmark"></i> Sustur</button>`;
                    }
                    btnHtml += `<button class="btn-primary" style="background:transparent; color:#c0392b; border-color:#c0392b;" onclick="app.adminDeleteUser(${user.id})"><i class="fa-solid fa-trash"></i> Hesabı Sil</button>`;
                    modBtns.innerHTML = btnHtml;
                } else {
                    modSection.classList.add('hidden');
                }
            } else {
                document.getElementById('admin-user-mod-section').classList.add('hidden');
            }


            // ===== FAVORİ KİTAPLAR =====
            const favBooksSection = document.getElementById('profile-fav-books-section');
            const favBooksContainer = document.getElementById('fav-books-container');
            const isOwnProfile = app.state.user && app.state.user.id === user.id;

            favBooksSection.classList.remove('hidden');
            const btnAddBook = document.getElementById('btn-add-fav-book');
            if (isOwnProfile && (data.favoriteBooks || []).length < 3) btnAddBook.classList.remove('hidden');
            else btnAddBook.classList.add('hidden');

            if (data.favoriteBooks && data.favoriteBooks.length > 0) {
                favBooksContainer.innerHTML = data.favoriteBooks.map(fb => `
                    <div class="fav-card">
                        ${fb.book_cover_url ? `<img src="${fb.book_cover_url}" class="fav-card-cover" alt="${fb.book_title}">` : `<div class="fav-card-cover-placeholder"><i class="fa-solid fa-book"></i></div>`}
                        <div class="fav-card-title">${fb.book_title}</div>
                        <div class="fav-card-sub">${fb.book_author || ''}</div>
                        ${isOwnProfile ? `<button class="fav-remove-btn" onclick="app.removeFavoriteBook(${fb.id})"><i class="fa-solid fa-xmark"></i></button>` : ''}
                    </div>
                `).join('');
            } else {
                favBooksContainer.innerHTML = `<p style="color:var(--text-secondary); font-size:0.9rem; grid-column:1/-1;">${isOwnProfile ? 'Henüz favori kitap eklemediniz.' : 'Favori kitap yok.'}</p>`;
            }

            // ===== FAVORİ YAZARLAR =====
            const favAuthorsSection = document.getElementById('profile-fav-authors-section');
            const favAuthorsContainer = document.getElementById('fav-authors-container');

            favAuthorsSection.classList.remove('hidden');
            const btnAddAuthor = document.getElementById('btn-add-fav-author');
            if (isOwnProfile && (data.favoriteAuthors || []).length < 3) btnAddAuthor.classList.remove('hidden');
            else btnAddAuthor.classList.add('hidden');

            if (data.favoriteAuthors && data.favoriteAuthors.length > 0) {
                favAuthorsContainer.innerHTML = data.favoriteAuthors.map(fa => `
                    <div class="fav-card">
                        ${fa.author_photo_url ? `<img src="${fa.author_photo_url}" class="fav-card-cover fav-card-author-photo" alt="${fa.author_name}">` : `<div class="fav-card-cover-placeholder"><i class="fa-solid fa-user-pen"></i></div>`}
                        <div class="fav-card-title">${fa.author_name}</div>
                        ${isOwnProfile ? `<button class="fav-remove-btn" onclick="app.removeFavoriteAuthor(${fa.id})"><i class="fa-solid fa-xmark"></i></button>` : ''}
                    </div>
                `).join('');
            } else {
                favAuthorsContainer.innerHTML = `<p style="color:var(--text-secondary); font-size:0.9rem; grid-column:1/-1;">${isOwnProfile ? 'Henüz favori yazar eklemediniz.' : 'Favori yazar yok.'}</p>`;
            }

        } catch (e) {
            app.toast(e.message);
            app.showHome();
        }
    },

    showFollowersModal() {
        if (!app.state.currentFollowersList || app.state.currentFollowersList.length === 0) {
            return app.toast('Bu yazarın henüz takipçisi bulunmuyor.');
        }

        const container = document.getElementById('followers-list-container');
        container.innerHTML = app.state.currentFollowersList.map(f => {
            const ava = f.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${f.username}&backgroundColor=2A2826&textColor=D4AF37`;
            return `
                <div style="display:flex; align-items:center; gap:15px; padding:10px; border-bottom:1px solid rgba(255,255,255,0.05); cursor:pointer;" onclick="app.closeModal('followers-modal'); app.showProfile('${f.username}')" onmouseover="this.style.background='rgba(197,160,89,0.1)'" onmouseout="this.style.background='transparent'">
                    <img src="${ava}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border:1px solid var(--accent-gold);">
                    <span style="color:var(--text-primary); font-family:'Inter'; font-weight:500;">${f.username}</span>
                </div>
            `;
        }).join('');

        app.showModal('followers-modal');
    },

    async toggleFollow() {
        if (!app.state.user) return app.showModal('auth-modal');
        try {
            await app.apiCall(`/profile/${app.state.viewingProfileId}/follow`, 'POST');
            app.toast('Takip listeniz güncellendi.');
            const currentUsername = document.getElementById('p-username').innerText;
            app.showProfile(currentUsername);
        } catch (e) { app.toast(e.message); }
    },

    async handleEditProfile(e) {
        e.preventDefault();
        const about_me = document.getElementById('p-about-input').value;
        const u = app.state.viewingProfileUsername;


        let avatar_url = document.getElementById('p-avatar').src;

        let payload = { about_me, avatar_url };


        if (app.state.user.is_admin) {
            const new_username = document.getElementById('p-admin-username').value;
            const email = document.getElementById('p-admin-email').value;
            const password = document.getElementById('p-admin-password').value;

            if (new_username) payload.new_username = new_username;
            if (email) payload.email = email;
            if (password && password.trim() !== '') payload.password = password;

            try {
                const res = await app.apiCall(`/admin/users/${u}/profile`, 'PUT', payload);
                app.toast(res.message);
                app.closeModal('edit-profile-modal');


                if (app.state.user.username === u) {
                    if (res.new_username) app.state.user.username = res.new_username;
                    app.state.user.about_me = about_me;
                    app.state.user.avatar_url = avatar_url;
                    localStorage.setItem('okuryazmaz_user', JSON.stringify(app.state.user));
                    app.renderAuthSection();
                }

                app.showProfile(res.new_username || u);
            } catch (err) { app.toast(err.message); }
        } else {

            try {
                await app.apiCall('/profile/edit', 'PUT', { about_me, avatar_url });
                app.state.user.about_me = about_me;
                localStorage.setItem('okuryazmaz_user', JSON.stringify(app.state.user));
                app.toast('Biyografiniz mühürlendi.');
                app.closeModal('edit-profile-modal');
                app.showProfile(u);
            } catch (err) { app.toast(err.message); }
        }
    },

    async handleEditAvatar(e) {
        e.preventDefault();
        const fileInput = document.getElementById('p-avatar-file');
        const file = fileInput.files[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) return app.toast('Dosya boyutu 2MB sınırını aşıyor.');

        const reader = new FileReader();
        reader.onload = async (event) => {
            const avatar_url = event.target.result;
            const u = app.state.viewingProfileUsername;

            try {

                const about_me = document.getElementById('p-about').innerText === "Yazar henüz diviti eline alıp kendinden bahsetmemiş."
                    ? "" : document.getElementById('p-about').innerText;

                if (app.state.user.is_admin) {
                    await app.apiCall(`/admin/users/${u}/profile`, 'PUT', { about_me, avatar_url });
                    if (app.state.user.username === u) {
                        app.state.user.avatar_url = avatar_url;
                        localStorage.setItem('okuryazmaz_user', JSON.stringify(app.state.user));
                    }
                } else {
                    await app.apiCall('/profile/edit', 'PUT', { about_me, avatar_url });
                    app.state.user.avatar_url = avatar_url;
                    localStorage.setItem('okuryazmaz_user', JSON.stringify(app.state.user));
                }

                // Navbar'daki avatarı anında güncelle
                app.renderAuthSection();

                app.toast('Profil fotoğrafınız yenilendi.');
                app.closeModal('edit-avatar-modal');
                await app.showProfile(u);
                // Profil yüklendikten sonra navbar'ı bir kez daha güncelle (sunucu verisiyle senkron)
                app.renderAuthSection();
            } catch (err) { app.toast(err.message); }
        };
        reader.readAsDataURL(file);
    },

    handleBookSearch(e) {
        const query = e.target.value.trim();
        const drop = document.getElementById('book-autocomplete-dropdown');
        if (this.bookSearchTimeout) clearTimeout(this.bookSearchTimeout);
        if (query.length < 3) { drop.style.display = 'none'; return; }

        this.bookSearchTimeout = setTimeout(async () => {
            try {
                const books = await app.searchBooks(query, 5);
                if (books.length > 0) {
                    let html = '';
                    books.forEach(book => {
                        const coverUrl = book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg` : '';
                        const title = book.title.replace(/'/g, "\\'");
                        const author = book.author_name ? book.author_name.join(', ') : 'Bilinmez';
                        html += `
                        <div style="display:flex; gap:10px; padding:10px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05); align-items:center;" onclick="app.selectBook('${title}')" onmouseover="this.style.background='rgba(197,160,89,0.1)'" onmouseout="this.style.background='transparent'">
                            ${coverUrl ? `<img src="${coverUrl}" style="width:40px; height:60px; object-fit:cover; border-radius:2px;">` : `<div style="width:40px; height:60px; background:#222; display:flex; align-items:center; justify-content:center; border-radius:2px;"><i class="fa-solid fa-book" style="color:var(--text-secondary);"></i></div>`}
                            <div style="flex:1;">
                                <div style="color:var(--accent-gold); font-weight:600; font-family:'Playfair Display'; font-size:1.1rem;">${book.title}</div>
                                <div style="color:var(--text-secondary); font-size:0.85rem;">${author}</div>
                            </div>
                        </div>`;
                    });
                    drop.innerHTML = html;
                    drop.style.display = 'block';
                } else {
                    drop.innerHTML = `<div style="padding:10px; color:var(--text-secondary); text-align:center;">Sonuç bulunamadı.</div>`;
                    drop.style.display = 'block';
                }
            } catch (err) { }
        }, 500);
    },

    selectBook(title) {
        document.getElementById('t-book').value = title;
        document.getElementById('book-autocomplete-dropdown').style.display = 'none';
    },

    renderAuthSection() {
        const d = document.getElementById('auth-section');
        if (app.state.user) {
            const uAva = app.state.user.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${app.state.user.username}&backgroundColor=2A2826&textColor=D4AF37`;
            d.innerHTML = `<div style="display:flex; align-items:center; gap:15px; position:relative;">
                               <div style="position:relative; display:flex; align-items:center;">
                                   <button class="btn-icon" onclick="app.toggleNotifications()">
                                       <i class="fa-solid fa-bell"></i>
                                       <span id="notif-badge" class="notif-badge hidden">0</span>
                                   </button>
                                   <!-- Bildirim Dropdown'ı burada zille aynı kutuda -->
                                   <div id="notif-dropdown" class="notif-dropdown hidden glass-card">
                                       <div class="notif-header">Bildirimler <span onclick="app.markAllNotificationsRead()" style="font-size:0.7rem; color:var(--accent-gold); cursor:pointer;">Hepsi Okundu</span></div>
                                       <div id="notif-list" class="notif-list"></div>
                                   </div>
                               </div>
                               <img src="${uAva}" class="avatar-sm" style="border-color:var(--accent-gold); cursor:pointer;" onclick="app.showProfile('${app.state.user.username}')">
                               <span class="clickable-user" onclick="app.showProfile('${app.state.user.username}')" style="font-family:'Playfair Display'; font-size:1.2rem;">${app.state.user.username}</span> 
                               ${app.state.user.is_admin ? `<button class="btn-primary" onclick="app.showAdminPanel()" style="background:var(--accent-gold); color:black; padding: 6px 15px;"><i class="fa-solid fa-crown"></i> Yönetim</button>` : ''}
                               <button class="btn-primary" onclick="app.logout()" style="background:transparent; border:1px solid #D4AF37; color:#D4AF37; padding: 6px 15px;">Çıkış</button>
                           </div>`;
            app.loadNotifications();
        } else {
            d.innerHTML = `<button class="btn-primary" onclick="app.showModal('auth-modal')">Giriş / Kayıt</button>`;
        }
        app.renderReplyBox();
    },

    renderReplyBox() {
        const box = document.getElementById('reply-box-container');
        if (!box) return;
        if (app.state.user) {
            const uAva = app.state.user.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${app.state.user.username}&backgroundColor=2A2826&textColor=D4AF37`;
            const adminField = app.state.user.is_admin ? `
                <div style="margin-bottom:10px;">
                    <input type="text" id="reply-as-username" placeholder="(Kukla Modu) Adına cevaplanacak bot adı girin, kendi cevabınız için boş bırakın..." style="font-size:0.85rem; padding:8px; border:1px solid var(--accent-gold); color:var(--accent-gold); background:transparent; width: 100%;">
                </div>
            ` : '';
            box.innerHTML = `
                <div style="display:flex; gap:15px; margin-top:20px;">
                    <img src="${uAva}" class="avatar-sm" style="width:45px; height:45px;">
                    <form onsubmit="app.handleReply(event)" style="flex:1;">
                        ${adminField}
                        <textarea id="reply-content" rows="4" placeholder="Alıntı için çift tırnak kullanabilirsiniz..." required></textarea>
                        <button type="submit" class="btn-primary"><i class="fa-solid fa-pen-nib"></i> Ekle</button>
                    </form>
                </div>
            `;
        } else {
            box.innerHTML = `<p style="padding:15px; border:1px dashed var(--glass-border); border-radius:4px; text-align:center;">Fikir belirtebilmek için lütfen <a href="#" class="clickable-user" onclick="app.showModal('auth-modal')">Giriş Yap</a></p>`;
        }
    },

    showNewTopicModal() {
        if (!app.state.user) return app.showModal('auth-modal');
        if (!app.state.currentCategoryId) return app.toast('Önce sol bloktan bir raf seçmelisiniz.');
        const asUserInput = document.getElementById('t-as-username');
        if (app.state.user.is_admin) asUserInput.classList.remove('hidden');
        else asUserInput.classList.add('hidden');
        app.showModal('new-topic-modal');
    },

    async handleNewTopic(e) {
        e.preventDefault();
        const title = document.getElementById('t-title').value;
        const book = document.getElementById('t-book').value;
        const content = document.getElementById('t-content').value;
        const asUsernameEl = document.getElementById('t-as-username');
        const as_username = asUsernameEl ? asUsernameEl.value : null;
        try {
            app.toast('Künye hazırlanıyor, lütfen bekleyin...');
            await app.apiCall('/forum/topics', 'POST', { category_id: app.state.currentCategoryId, title, content, book_query: book, as_username });
            app.toast('Eseriniz kütüphaneye işlendi!');
            app.closeModal('new-topic-modal');
            document.getElementById('new-topic-form').reset();
            app.loadTopics(app.state.currentCategoryId);
        } catch (err) { document.getElementById('topic-error').innerText = err.message; }
    },

    async handleReply(e) {
        e.preventDefault();
        const content = document.getElementById('reply-content').value;
        const asUsernameEl = document.getElementById('reply-as-username');
        const as_username = asUsernameEl ? asUsernameEl.value : null;
        try {
            await app.apiCall(`/forum/topics/${app.state.currentTopicId}/posts`, 'POST', { content, as_username });
            app.toast('Cevabınız kaydedildi.');
            document.getElementById('reply-content').value = '';
            if (asUsernameEl) asUsernameEl.value = '';
            app.loadTopicDetail(app.state.currentTopicId);
        } catch (err) { app.toast(err.message); }
    },

    async handleLogin(e) {
        e.preventDefault();
        try {
            const data = await app.apiCall('/auth/login', 'POST', {
                username: document.getElementById('l-username').value, password: document.getElementById('l-password').value
            });
            app.state.token = data.token; app.state.user = data.user;
            localStorage.setItem('okuryazmaz_token', data.token); localStorage.setItem('okuryazmaz_user', JSON.stringify(data.user));
            app.closeModal('auth-modal'); app.toast('Kütüphaneye hoş geldiniz!'); app.renderAuthSection();
        } catch (err) { document.getElementById('login-error').innerText = err.message; }
    },

    async handleRegister(e) {
        e.preventDefault();
        try {
            await app.apiCall('/auth/register', 'POST', {
                username: document.getElementById('r-username').value, email: document.getElementById('r-email').value, password: document.getElementById('r-password').value
            });
            app.toast('Kayıt Başarılı, Lütfen Giriş Yapın.');
            app.switchAuthTab('login');
        } catch (err) { document.getElementById('register-error').innerText = err.message; }
    },

    switchAdminTab(tab) {
        document.getElementById('tab-admin-bots').classList.remove('active');
        document.getElementById('tab-admin-users').classList.remove('active');
        document.getElementById('tab-admin-reports').classList.remove('active');
        document.getElementById('tab-admin-activity').classList.remove('active');
        document.getElementById('admin-bots-section').classList.add('hidden');
        document.getElementById('admin-users-section').classList.add('hidden');
        document.getElementById('admin-reports-section').classList.add('hidden');
        document.getElementById('admin-activity-section').classList.add('hidden');
        document.getElementById(`tab-admin-${tab}`).classList.add('active');
        document.getElementById(`admin-${tab}-section`).classList.remove('hidden');

        if (tab === 'bots') app.loadAdminBots();
        else if (tab === 'users') app.loadAllUsers();
        else if (tab === 'reports') app.loadAdminReports();
        else if (tab === 'activity') app.loadBotActivity();
    },

    showAdminPanel() {
        if (!app.state.user || !app.state.user.is_admin) return app.toast('Yetkisiz erişim.');
        app.handleRoute('/admin');
    },

    _showAdminPanelInternal() {
        app.hideAllViews();
        document.getElementById('view-admin').classList.remove('hidden');
        app.switchAdminTab('bots');
    },

    async loadAllUsers() {
        const container = document.getElementById('admin-users-container');
        container.innerHTML = '<tr><td colspan="6">Yükleniyor...</td></tr>';
        try {
            const users = await app.apiCall('/admin/users');
            container.innerHTML = users.map(u => `
                <tr style="border-bottom:1px solid var(--glass-border);">
                    <td style="padding:10px;">${u.id}</td>
                    <td style="padding:10px; cursor:pointer;" onclick="app.showProfile('${u.username}')"><img src="${u.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${u.username}&backgroundColor=2A2826&textColor=D4AF37`}" style="width:30px; border-radius:50%;"></td>
                    <td style="padding:10px; cursor:pointer; color:var(--accent-gold);" onclick="app.showProfile('${u.username}')">${u.username}</td>
                    <td style="padding:10px; color:var(--text-secondary);">${u.email}</td>
                    <td style="padding:10px; color:var(--text-secondary);">${new Date(u.created_at + "Z").toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td style="padding:10px; color:var(--text-secondary);">${u.is_ai ? '<span style="color:#C5A059">Bot</span>' : 'İnsan'}</td>
                </tr>
            `).join('');
        } catch (e) { app.toast(e.message); }
    },

    async loadAdminBots() {
        const container = document.getElementById('admin-bots-container');
        container.innerHTML = '<tr><td colspan="4">Yükleniyor...</td></tr>';
        try {
            const bots = await app.apiCall('/admin/bots');
            container.innerHTML = bots.map(b => `
                <tr style="border-bottom:1px solid var(--glass-border);">
                    <td style="padding:10px;">${b.id}</td>
                    <td style="padding:10px; cursor:pointer;" onclick="app.showProfile('${b.username}')"><img src="${b.avatar_url}" style="width:30px; border-radius:50%;"></td>
                    <td style="padding:10px; cursor:pointer; color:var(--accent-gold);" onclick="app.showProfile('${b.username}')">${b.username}</td>
                    <td style="padding:10px; color:var(--text-secondary);">${b.email}</td>
                </tr>
            `).join('');
        } catch (e) { app.toast(e.message); }
    },

    async loadAdminReports() {
        const container = document.getElementById('admin-reports-container');
        container.innerHTML = '<tr><td colspan="6">Raporlar inceleniyor...</td></tr>';
        try {
            const reports = await app.apiCall('/admin/reports');
            container.innerHTML = reports.map(r => `
                <tr style="border-bottom:1px solid var(--glass-border);">
                    <td style="padding:10px; color:var(--accent-gold); font-weight:bold;">${r.target_type === 'topic' ? 'KONU' : 'İLETİ'}</td>
                    <td style="padding:10px; cursor:pointer; text-decoration:underline;" onclick="app.loadTopicDetail(${r.target_type === 'topic' ? r.target_id : '0 '})">${r.target_id}</td>
                    <td style="padding:10px;">${r.reporter_name}</td>
                    <td style="padding:10px; font-size:0.85rem;">${r.reason}</td>
                    <td style="padding:10px;">${r.status === 'pending' ? '<span style="color:#d35400;">Bekliyor</span>' : '<span style="color:#27ae60;">Çözüldü</span>'}</td>
                    <td style="padding:10px;">
                        ${r.status === 'pending' ? `<button class="btn-primary" style="padding:4px 10px; font-size:0.75rem;" onclick="app.resolveReport(${r.id})">Çözüldü</button>` : '-'}
                    </td>
                </tr>
            `).join('');
        } catch (e) { app.toast(e.message); }
    },

    async resolveReport(id) {
        try {
            await app.apiCall(`/admin/reports/${id}/resolve`, 'PUT');
            app.toast('Rapor çözüldü ve şikayetçi bilgilendirildi.');
            app.loadAdminReports();
        } catch (e) { app.toast(e.message); }
    },

    async handleNewBot(e) {
        e.preventDefault();
        try {
            await app.apiCall('/admin/bots', 'POST', {
                username: document.getElementById('b-username').value,
                email: document.getElementById('b-email').value,
                avatar_url: document.getElementById('b-avatar').value
            });
            app.toast('Persona kütüphaneye dahil edildi!');
            app.closeModal('new-bot-modal');
            document.getElementById('new-bot-form').reset();
            app.loadAdminBots();
        } catch (err) { app.toast(err.message); }
    },

    async triggerAIPost() {
        app.toast('Botlar uyandırılıyor...');
        try {
            const res = await app.apiCall('/admin/trigger-bot', 'POST');
            app.toast(res.message);
        } catch (err) { app.toast(err.message); }
    },

    async toggleHideTopic(topicId, isHidden) {
        if (!confirm(isHidden ? 'Bu konuyu tekrar görünür yapmak istediğinize emin misiniz?' : 'Bu konuyu gizlemek istediğinize emin misiniz?')) return;
        try {
            await app.apiCall(`/admin/topics/${topicId}/hide`, 'PUT', { is_hidden: !isHidden });
            app.toast('Konu görünürlüğü güncellendi.');
            app.loadTopicDetail(topicId);
        } catch (e) { app.toast(e.message); }
    },

    async deleteTopic(topicId) {
        if (!confirm('Bu eseri tamamen ve kalıcı olarak silmek istediğinize çok emin misiniz?')) return;
        try {
            await app.apiCall(`/admin/topics/${topicId}`, 'DELETE');
            app.toast('Eser külliyattan silindi.');
            app.goBackToTopics();
        } catch (e) { app.toast(e.message); }
    },

    async deletePost(id) {
        if (!confirm('Bu iletiyi tamamen silmek istediğinize emin misiniz?')) return;
        try {
            await app.apiCall(`/admin/posts/${id}`, 'DELETE');
            app.toast('İleti silindi.');
            app.loadTopicDetail(app.state.currentTopicId);
        } catch (e) { app.toast(e.message); }
    },

    showEditTopicModal(id) {
        const topic = app.state.loadedTopic;
        if (!topic || topic.id !== id) return;
        document.getElementById('edit-t-id').value = id;
        document.getElementById('edit-t-title').value = topic.title;
        document.getElementById('edit-t-content').value = topic.content.replace(/\\n/g, '\n');
        app.showModal('edit-topic-modal');
    },

    async handleEditTopic(e) {
        e.preventDefault();
        const id = document.getElementById('edit-t-id').value;
        const title = document.getElementById('edit-t-title').value;
        const content = document.getElementById('edit-t-content').value;
        try {
            await app.apiCall(`/admin/topics/${id}`, 'PUT', { title, content });
            app.toast('Eser güncellendi.');
            app.closeModal('edit-topic-modal');
            app.loadTopicDetail(id);
        } catch (err) { app.toast(err.message); }
    },

    showEditPostModal(id) {
        const post = app.state.loadedPosts.find(p => p.id === id);
        if (!post) return;
        document.getElementById('edit-p-id').value = id;
        document.getElementById('edit-p-content').value = post.content.replace(/\\n/g, '\n');
        app.showModal('edit-post-modal');
    },

    async handleEditPost(e) {
        e.preventDefault();
        const id = document.getElementById('edit-p-id').value;
        const content = document.getElementById('edit-p-content').value;
        try {
            await app.apiCall(`/forum/posts/${id}`, 'PUT', { content });
            app.toast('Satırlar güncellendi.');
            app.closeModal('edit-post-modal');
            app.loadTopicDetail(app.state.currentTopicId);
        } catch (err) { app.toast(err.message); }
    },

    logout() {
        app.state.user = null; app.state.token = null;
        localStorage.removeItem('okuryazmaz_token'); localStorage.removeItem('okuryazmaz_user');
        app.showHome();
        app.toast('Sayfa kapatıldı (Çıkış yapıldı).');
        app.renderAuthSection();
    },


    showReportModal(type, id) {
        document.getElementById('report-target-type').value = type;
        document.getElementById('report-target-id').value = id;
        document.getElementById('report-reason').value = '';
        app.showModal('report-modal');
    },

    async handleReport(e) {
        e.preventDefault();
        const target_type = document.getElementById('report-target-type').value;
        const target_id = document.getElementById('report-target-id').value;
        const reason = document.getElementById('report-reason').value;
        try {
            await app.apiCall('/report', 'POST', { target_type, target_id, reason });
            app.toast('Şikayetiniz yönetime sunuldu.');
            app.closeModal('report-modal');
        } catch (err) { app.toast(err.message); }
    },

    async showPostHistory(postId) {
        if (!app.state.user || !app.state.user.is_admin) return;
        try {
            const history = await app.apiCall(`/admin/posts/${postId}/history`);
            const container = document.getElementById('history-container');
            container.innerHTML = history.length === 0
                ? '<p>Geçmişte herhangi bir değişiklik yapılmamış.</p>'
                : history.map(h => `
                    <div class="history-item">
                        <div class="history-item-header">Tarih: ${new Date(h.edited_at + "Z").toLocaleString('tr-TR')}</div>
                        <div style="white-space:pre-wrap;">${h.old_content}</div>
                    </div>
                `).join('');
            app.showModal('history-modal');
        } catch (e) { app.toast(e.message); }
    },

    // ===== ANA SAYFA İÇERİK YÜKLEME =====
    async loadHomepageContent() {
        app.loadHomeBooks();
        app.loadRecentTopics();
        app.loadStats();
        app.loadRecentMembers();
    },

    async loadHomeBooks() {
        const container = document.getElementById('home-books-container');
        if (!container) return;

        try {
            const res = await app.apiCall('/forum/random-books');
            const books = res || [];

            if (books.length > 0) {
                container.innerHTML = books.slice(0, 6).map(book => {
                    const coverId = book.cover_id;
                    const coverHtml = coverId
                        ? `<img src="https://covers.openlibrary.org/b/id/${coverId}-M.jpg" class="book-card-cover" alt="kitap kapağı" loading="lazy">`
                        : `<div class="book-card-cover-placeholder"><i class="fa-solid fa-book"></i></div>`;
                    const authors = book.authors ? book.authors.map(a => a.name).join(', ') : '';
                    return `
                        <div class="book-card" data-bookkey="${book.key}" data-coverid="${coverId || ''}" title="${authors}">
                            ${coverHtml}
                            <div class="book-card-body">
                                <div class="book-card-title">${book.title}</div>
                                <div class="book-card-author">${authors}</div>
                            </div>
                        </div>
                    `;
                }).join('');

                // Event delegation ile tıklama
                container.querySelectorAll('.book-card').forEach(card => {
                    card.addEventListener('click', () => {
                        const key = card.getAttribute('data-bookkey').replace('/works/', '');
                        const title = card.querySelector('.book-card-title').innerText;
                        app.handleRoute(`/kitap/${key}-${app.slugify(title)}`);
                    });
                });
            } else {
                container.innerHTML = '<p style="text-align:center; color:var(--text-secondary); grid-column:1/-1;">Kitaplar yüklenemedi.</p>';
            }
        } catch (e) {
            container.innerHTML = '<p style="text-align:center; color:var(--text-secondary); grid-column:1/-1;">Kitap servisi şu an ulaşılamıyor.</p>';
        }
    },

    async loadRecentTopics() {
        const container = document.getElementById('home-recent-topics');
        if (!container) return;

        try {
            const topics = await app.apiCall('/forum/recent-topics');
            if (topics.length === 0) {
                container.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:1rem;">Henüz hiç konu açılmamış. İlk eseri sen bırakabilirsin!</p>';
                return;
            }
            container.innerHTML = topics.map(t => {
                const ava = t.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${t.username}&backgroundColor=1E1C1A&textColor=C5A059`;
                const replyCount = t.reply_count || 0;
                const timeAgo = app.timeAgo(t.created_at);
                return `
                    <div class="recent-topic-row" onclick="app.loadTopicDetail(${t.id}, '${t.title.replace(/'/g, "\\'")}')">
                        <img src="${ava}" class="avatar-sm" style="width:38px; height:38px; flex-shrink:0;" alt="avatar">
                        <div style="flex:1; overflow:hidden;">
                            <div class="recent-topic-title">${t.title}</div>
                            <div class="recent-topic-meta">
                                <span class="clickable-user" onclick="event.stopPropagation(); app.showProfile('${t.username}')" style="font-size:0.82rem;">${t.username}</span>
                                <span style="opacity:0.3;">|</span>
                                <span>${t.views || 0} okuma</span>
                                <span style="opacity:0.3;">|</span>
                                <span><i class="fa-regular fa-comment"></i> ${replyCount}</span>
                                <span style="opacity:0.3;">|</span>
                                <span>${timeAgo}</span>
                                ${t.category_name ? `<span class="recent-topic-badge">${t.category_name}</span>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (e) {
            container.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:1rem;">Son konular yüklenemedi.</p>';
        }
    },

    async loadStats() {
        try {
            const stats = await app.apiCall('/forum/stats');
            app.animateCounter('stat-users', stats.users);
            app.animateCounter('stat-topics', stats.topics);
            app.animateCounter('stat-posts', stats.posts);
            app.animateCounter('stat-categories', stats.categories);
        } catch (e) { }
    },

    animateCounter(elementId, target) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const duration = 1200;
        const start = parseInt(el.innerText) || 0;
        const increment = (target - start) / (duration / 16);
        let current = start;
        const timer = setInterval(() => {
            current += increment;
            if ((increment > 0 && current >= target) || (increment < 0 && current <= target) || increment === 0) {
                el.innerText = target;
                clearInterval(timer);
            } else {
                el.innerText = Math.round(current);
            }
        }, 16);
    },

    timeAgo(dateStr) {
        const now = new Date();
        const date = new Date(dateStr + 'Z');
        const diff = Math.floor((now - date) / 1000);
        if (diff < 60) return 'az önce';
        if (diff < 3600) return Math.floor(diff / 60) + ' dk önce';
        if (diff < 86400) return Math.floor(diff / 3600) + ' saat önce';
        if (diff < 604800) return Math.floor(diff / 86400) + ' gün önce';
        return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
    },

    async loadRecentMembers() {
        const container = document.getElementById('home-recent-members');
        if (!container) return;
        try {
            const members = await app.apiCall('/forum/recent-members');
            if (members.length === 0) {
                container.innerHTML = '<p style="color:var(--text-secondary); text-align:center; grid-column:1/-1;">Henüz üye yok.</p>';
                return;
            }
            container.innerHTML = members.map(m => {
                const ava = m.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${m.username}&backgroundColor=2A2826&textColor=D4AF37`;
                const timeAgo = app.timeAgo(m.created_at);
                return `
                    <div class="member-card" onclick="app.showProfile('${m.username}')">
                        <img src="${ava}" alt="${m.username}">
                        <div class="member-card-name">${m.username}</div>
                        <div class="member-card-date">${timeAgo}</div>
                    </div>
                `;
            }).join('');
        } catch (e) {
            container.innerHTML = '<p style="color:var(--text-secondary); text-align:center; grid-column:1/-1;">Üyeler yüklenemedi.</p>';
        }
    },

    async loadBotActivity() {
        const container = document.getElementById('admin-activity-container');
        if (!container) return;
        try {
            const activities = await app.apiCall('/admin/bot-activity');
            if (activities.length === 0) {
                container.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:2rem;">Henüz bot aktivitesi yok.</p>';
                return;
            }
            container.innerHTML = activities.map(a => {
                const ava = a.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${a.username}&backgroundColor=2A2826&textColor=D4AF37`;
                const contentSnippet = (a.content || '').replace(/<[^>]*>?/gm, '').substring(0, 120);
                const typeLabel = a.activity_type === 'topic' ? 'KONU' : 'YORUM';
                const typeClass = a.activity_type === 'topic' ? 'type-topic' : 'type-post';
                return `
                    <div class="bot-activity-card">
                        <img src="${ava}" class="avatar-sm" style="width:38px; height:38px; flex-shrink:0;" alt="${a.username}">
                        <div style="flex:1; overflow:hidden;">
                            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                                <span class="bot-activity-type ${typeClass}">${typeLabel}</span>
                                <span class="clickable-user" onclick="app.showProfile('${a.username}')" style="font-size:0.95rem;">${a.username}</span>
                                <span style="color:var(--text-secondary); font-size:0.78rem; margin-left:auto;">${new Date(a.created_at + 'Z').toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                            </div>
                            <div style="color:var(--accent-gold); font-size:0.85rem; font-family:'Playfair Display'; margin-bottom:3px; cursor:pointer;" onclick="app.loadTopicDetail(${a.topic_id})">${a.topic_title}</div>
                            <div style="color:var(--text-secondary); font-size:0.85rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${contentSnippet}...</div>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (e) {
            container.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:2rem;">Aktiviteler yüklenemedi.</p>';
        }
    },

    // ===== MOBİL MENÜ =====
    toggleMobileMenu() {
        const sidebar = document.getElementById('main-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (!sidebar || !overlay) return;
        sidebar.classList.toggle('mobile-open');
        overlay.classList.toggle('hidden');
    },

    // ===== KİTAP DETAY MODALI =====
    async showBookDetail(bookKey, coverId) {
        const container = document.getElementById('book-detail-content');
        container.innerHTML = '<div class="loading-pulse" style="text-align:center; padding:3rem;">Kitap bilgileri getiriliyor...</div>';
        app.showModal('book-detail-modal');

        try {
            const res = await fetch(`https://openlibrary.org${bookKey}.json`);
            const book = await res.json();

            let title = book.title || 'Bilinmeyen Eser';
            let description = '';
            if (book.description) {
                description = typeof book.description === 'string' ? book.description : book.description.value || '';
            }
            let subjects = (book.subjects || []).slice(0, 4).join(', ');

            // Çeviri İsteği
            try {
                const transRes = await fetch('/api/forum/translate-book', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, description, subjects })
                });
                const transData = await transRes.json();
                if (transData.title) title = transData.title;
                if (transData.description) description = transData.description;
                if (transData.subjects) subjects = transData.subjects;
            } catch (e) {
                console.error("Çeviri başarısız", e);
            }

            // Yazar bilgisi
            let authorName = 'Bilinmiyor';
            if (book.authors && book.authors.length > 0) {
                try {
                    const authorRes = await fetch(`https://openlibrary.org${book.authors[0].author.key}.json`);
                    const authorData = await authorRes.json();
                    authorName = authorData.name || 'Bilinmiyor';
                } catch (e) { }
            }

            // Kapak
            const coverHtml = coverId
                ? `<img src="https://covers.openlibrary.org/b/id/${coverId}-L.jpg" class="book-detail-cover" alt="${title}">`
                : `<div class="book-detail-cover-placeholder"><i class="fa-solid fa-book"></i></div>`;

            const descHtml = description
                ? `<div class="book-detail-desc">${description.substring(0, 600)}${description.length > 600 ? '...' : ''}</div>`
                : '';

            // Meta bilgiler
            const publishDate = book.first_publish_date || book.publish_date || '-';
            const pages = book.number_of_pages || '-';

            container.innerHTML = `
                <div class="book-detail-hero">
                    ${coverHtml}
                    <div class="book-detail-info">
                        <div class="book-detail-title">${title}</div>
                        <div class="book-detail-author"><i class="fa-solid fa-feather" style="margin-right:6px;"></i>${authorName}</div>
                        <div class="book-detail-meta">
                            ${publishDate !== '-' ? `<div class="book-detail-meta-row"><i class="fa-regular fa-calendar"></i> ${publishDate}</div>` : ''}
                            ${pages !== '-' ? `<div class="book-detail-meta-row"><i class="fa-solid fa-file-lines"></i> ${pages} sayfa</div>` : ''}
                            ${subjects ? `<div class="book-detail-meta-row"><i class="fa-solid fa-tags"></i> ${subjects}</div>` : ''}
                        </div>
                    </div>
                </div>
                ${descHtml}
                <div class="book-detail-actions">
                    <button class="btn-primary" onclick="app.closeModal('book-detail-modal'); app.showNewTopicModal(); setTimeout(() => { const ti = document.getElementById('new-topic-title'); if(ti) ti.value = '${title.replace(/'/g, "\\'")}: '; }, 200);">
                        <i class="fa-solid fa-pen-nib"></i> Bu Kitabı Tartış
                    </button>
                </div>
            `;
        } catch (e) {
            container.innerHTML = '<p style="text-align:center; padding:2rem; color:var(--text-secondary);">Kitap bilgileri yüklenemedi.</p>';
        }
    },

    // ===== FAVORİ SİSTEMİ =====
    _favSearchType: 'book',
    _favSearchTimer: null,

    openFavSearch(type) {
        app._favSearchType = type;
        document.getElementById('fav-search-title').textContent = type === 'book' ? 'Favori Kitap Ekle' : 'Favori Yazar Ekle';
        document.getElementById('fav-search-input').placeholder = type === 'book' ? 'Kitap adı yazın...' : 'Yazar adı yazın...';
        document.getElementById('fav-search-input').value = '';
        document.getElementById('fav-search-results').innerHTML = '';
        app.showModal('fav-search-modal');
        setTimeout(() => document.getElementById('fav-search-input').focus(), 200);
    },

    searchFavorite() {
        clearTimeout(app._favSearchTimer);
        const query = document.getElementById('fav-search-input').value.trim();
        if (query.length < 2) {
            document.getElementById('fav-search-results').innerHTML = '';
            return;
        }
        app._favSearchTimer = setTimeout(async () => {
            const results = document.getElementById('fav-search-results');
            results.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:1rem;">Aranıyor...</p>';

            try {
                if (app._favSearchType === 'book') {
                    const books = await app.searchBooks(query, 8);
                    if (books.length > 0) {
                        results.innerHTML = books.map(d => {
                            const cover = d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg` : '';
                            const author = d.author_name ? d.author_name[0] : '';
                            const safeTitle = (d.title || '').replace(/'/g, "\\'");
                            const safeAuthor = author.replace(/'/g, "\\'");
                            return `
                                <div class="fav-search-item" onclick="app.addFavoriteBook('${safeTitle}', '${safeAuthor}', '${cover}', '${d.key}')">
                                    ${cover ? `<img src="${cover}" class="fav-search-thumb">` : '<div class="fav-search-thumb-placeholder"><i class="fa-solid fa-book"></i></div>'}
                                    <div>
                                        <div style="font-weight:600; color:var(--text-primary);">${d.title}</div>
                                        <div style="font-size:0.85rem; color:var(--text-secondary);">${author}</div>
                                    </div>
                                </div>
                            `;
                        }).join('');
                    } else {
                        results.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:1rem;">Sonuç bulunamadı.</p>';
                    }
                } else {
                    const res = await fetch(`https://openlibrary.org/search/authors.json?q=${encodeURIComponent(query)}&limit=8`);
                    const data = await res.json();
                    if (data.docs && data.docs.length > 0) {
                        results.innerHTML = data.docs.map(d => {
                            const photoUrl = d.key ? `https://covers.openlibrary.org/a/olid/${d.key}-M.jpg` : '';
                            const safeName = (d.name || '').replace(/'/g, "\\'");
                            return `
                                <div class="fav-search-item" onclick="app.addFavoriteAuthor('${safeName}', '${photoUrl}', '${d.key}')">
                                    ${photoUrl ? `<img src="${photoUrl}" class="fav-search-thumb" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'"><div class="fav-search-thumb-placeholder" style="display:none;"><i class="fa-solid fa-user-pen"></i></div>` : '<div class="fav-search-thumb-placeholder"><i class="fa-solid fa-user-pen"></i></div>'}
                                    <div>
                                        <div style="font-weight:600; color:var(--text-primary);">${d.name}</div>
                                        <div style="font-size:0.85rem; color:var(--text-secondary);">${d.work_count || 0} eser</div>
                                    </div>
                                </div>
                            `;
                        }).join('');
                    } else {
                        results.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:1rem;">Sonuç bulunamadı.</p>';
                    }
                }
            } catch (e) {
                results.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:1rem;">Arama yapılamadı.</p>';
            }
        }, 400);
    },

    async addFavoriteBook(title, author, coverUrl, key) {
        try {
            await app.apiCall('/profile/favorites/book', 'POST', { book_title: title, book_author: author, book_cover_url: coverUrl, book_key: key });
            app.toast('Favori kitap eklendi!');
            app.closeModal('fav-search-modal');
            app.showProfile(app.state.viewingProfileUsername);
        } catch (e) { app.toast(e.message); }
    },

    async removeFavoriteBook(id) {
        try {
            await app.apiCall(`/profile/favorites/book/${id}`, 'DELETE');
            app.toast('Favori kitap silindi.');
            app.showProfile(app.state.viewingProfileUsername);
        } catch (e) { app.toast(e.message); }
    },

    async addFavoriteAuthor(name, photoUrl, key) {
        try {
            await app.apiCall('/profile/favorites/author', 'POST', { author_name: name, author_photo_url: photoUrl, author_key: key });
            app.toast('Favori yazar eklendi!');
            app.closeModal('fav-search-modal');
            app.showProfile(app.state.viewingProfileUsername);
        } catch (e) { app.toast(e.message); }
    },

    async removeFavoriteAuthor(id) {
        try {
            await app.apiCall(`/profile/favorites/author/${id}`, 'DELETE');
            app.toast('Favori yazar silindi.');
            app.showProfile(app.state.viewingProfileUsername);
        } catch (e) { app.toast(e.message); }
    },

    // ===== ADMİN ROZET YÖNETİMİ =====
    async openAdminBadgePanel() {
        const userId = app.state.viewingProfileId;
        const username = app.state.viewingProfileUsername;
        document.getElementById('admin-badge-username').innerHTML = `<i class="fa-solid fa-user" style="margin-right:6px;"></i> <strong>${username}</strong> için rozet yönetimi`;

        try {
            const allBadges = await app.apiCall('/profile/badges/all');
            const profileData = await app.apiCall(`/profile/${username}`);
            const earnedCodes = new Set((profileData.badges || []).map(b => b.code));

            const categories = { writing: 'Yazarlık', engagement: 'Yorum', social: 'Sosyal', collection: 'Koleksiyon', loyalty: 'Sadakat', special: 'Özel' };
            let html = '';

            for (const [catCode, catName] of Object.entries(categories)) {
                const catBadges = allBadges.filter(b => b.category === catCode);
                if (catBadges.length === 0) continue;
                html += `<h4 style="color:var(--accent-gold); margin:12px 0 8px; font-size:0.9rem;">${catName}</h4>`;
                html += catBadges.map(b => {
                    const hasIt = earnedCodes.has(b.code);
                    return `
                        <div class="admin-badge-row" style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-bottom:1px solid var(--glass-border);">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <i class="fa-solid ${b.icon}" style="color:${b.color}; font-size:1.1rem; width:22px; text-align:center;"></i>
                                <div>
                                    <div style="font-weight:600; font-size:0.9rem; color:${hasIt ? 'var(--text-primary)' : 'var(--text-secondary)'};">${b.name}</div>
                                    <div style="font-size:0.78rem; color:var(--text-secondary);">${b.description}</div>
                                </div>
                            </div>
                            ${hasIt
                            ? `<button class="btn-primary" style="padding:3px 10px; font-size:0.75rem; background:#c0392b; border-color:#c0392b;" onclick="app.adminRevokeBadge(${userId}, '${b.code}')"><i class="fa-solid fa-xmark"></i> Al</button>`
                            : `<button class="btn-primary" style="padding:3px 10px; font-size:0.75rem;" onclick="app.adminGrantBadge(${userId}, '${b.code}')"><i class="fa-solid fa-plus"></i> Ver</button>`
                        }
                        </div>
                    `;
                }).join('');
            }

            document.getElementById('admin-badge-list').innerHTML = html;
            app.showModal('admin-badge-modal');
        } catch (e) { app.toast(e.message); }
    },

    async adminGrantBadge(userId, badgeCode) {
        try {
            const result = await app.apiCall('/profile/admin/badge/grant', 'POST', { user_id: userId, badge_code: badgeCode });
            app.toast(result.message);
            app.openAdminBadgePanel();
            app.showProfile(app.state.viewingProfileUsername);
        } catch (e) { app.toast(e.message); }
    },

    async adminRevokeBadge(userId, badgeCode) {
        try {
            const result = await app.apiCall('/profile/admin/badge/revoke', 'POST', { user_id: userId, badge_code: badgeCode });
            app.toast(result.message);
            app.openAdminBadgePanel();
            app.showProfile(app.state.viewingProfileUsername);
        } catch (e) { app.toast(e.message); }
    },

    // ===== ADMİN MODERASYON İŞLEMLERİ =====
    async adminBanUser(userId) {
        const reason = prompt("Yasaklama sebebini girin (İsteğe bağlı):", "Kurallara aykırı davranış");
        if (reason === null) return;
        try {
            const result = await app.apiCall('/profile/admin/ban', 'POST', { user_id: userId, reason });
            app.toast(result.message);
            app.showProfile(app.state.viewingProfileUsername);
        } catch (e) { app.toast(e.message); }
    },

    async adminUnbanUser(userId) {
        if (!confirm("Bu kullanıcının yasağını kaldırmak istediğinize emin misiniz?")) return;
        try {
            const result = await app.apiCall('/profile/admin/unban', 'POST', { user_id: userId });
            app.toast(result.message);
            app.showProfile(app.state.viewingProfileUsername);
        } catch (e) { app.toast(e.message); }
    },

    async adminMuteUser(userId) {
        const minutes = prompt("Susturma süresini dakika olarak girin (Varsayılan: 60):", "60");
        if (minutes === null) return;
        const duration = parseInt(minutes) || 60;
        try {
            const result = await app.apiCall('/profile/admin/mute', 'POST', { user_id: userId, duration_minutes: duration });
            app.toast(result.message);
            app.showProfile(app.state.viewingProfileUsername);
        } catch (e) { app.toast(e.message); }
    },

    async adminUnmuteUser(userId) {
        if (!confirm("Kullanıcının susturmasını kaldırmak istediğinize emin misiniz?")) return;
        try {
            const result = await app.apiCall('/profile/admin/unmute', 'POST', { user_id: userId });
            app.toast(result.message);
            app.showProfile(app.state.viewingProfileUsername);
        } catch (e) { app.toast(e.message); }
    },

    async adminDeleteUser(userId) {
        const confirmation = prompt(`DİKKAT! Bu işlem geri alınamaz.\nKullanıcıyı ve ona ait TÜM konuları, yorumları, rozetleri ve verileri silmek için "SİL" yazın:`);
        if (confirmation !== "SİL") {
            app.toast("Silme işlemi iptal edildi.");
            return;
        }
        try {
            const result = await app.apiCall('/profile/admin/delete-user', 'POST', { user_id: userId });
            app.toast(result.message);
            app.showHome();
        } catch (e) { app.toast(e.message); }
    },

    // ==========================================
    // ALINTILAR (QUOTES) MODÜLÜ
    // ==========================================

    showQuotes() {
        app.hideAllViews();
        const viewQuotes = document.getElementById('view-quotes');
        if (viewQuotes) viewQuotes.classList.remove('hidden');

        // Aktif kategori vurgusu
        document.querySelectorAll('.cat-shelf-item').forEach(c => c.classList.remove('active-cat'));
        const quotesBtn = document.getElementById('nav-quotes-btn');
        if (quotesBtn) quotesBtn.classList.add('active-cat');

        document.title = 'Kitaplardan İnciler - Okuryazmaz';
        app.loadQuotesFeed();
    },

    showNewQuoteModal(bookTitle, bookKey) {
        if (!app.state.user) { app.showModal('auth-modal'); return; }
        const modal = document.getElementById('new-quote-modal');
        if (modal) modal.classList.remove('hidden');

        if (bookTitle) document.getElementById('q-book').value = bookTitle;
        if (bookKey) document.getElementById('q-book-key').value = bookKey;

        if (app.state.user && app.state.user.is_admin) {
            const asUser = document.getElementById('q-as-username');
            if (asUser) asUser.classList.remove('hidden');
        }
    },

    async searchBookForQuote(query) {
        if (!query || query.length < 3) {
            document.getElementById('quote-book-autocomplete-dropdown').style.display = 'none';
            return;
        }
        try {
            const books = await app.searchBooks(query, 5);
            const dropdown = document.getElementById('quote-book-autocomplete-dropdown');
            if (books.length > 0) {
                dropdown.innerHTML = '';
                books.forEach(book => {
                    const div = document.createElement('div');
                    div.style.cssText = 'padding:10px 15px; cursor:pointer; border-bottom:1px solid var(--glass-border); color:var(--text-primary); transition:0.2s;';
                    div.onmouseover = () => div.style.background = 'rgba(197,160,89,0.1)';
                    div.onmouseout = () => div.style.background = 'transparent';
                    div.innerText = `${book.title} - ${book.author_name ? book.author_name.join(', ') : 'Bilinmeyen Yazar'}`;
                    div.onclick = () => {
                        document.getElementById('q-book').value = book.title;
                        document.getElementById('q-book-key').value = book.key;
                        dropdown.style.display = 'none';
                    };
                    dropdown.appendChild(div);
                });
                dropdown.style.display = 'block';
                dropdown.style.background = 'var(--bg-surface)';
                dropdown.style.border = '1px solid var(--glass-border)';
                dropdown.style.borderRadius = '8px';
            } else {
                dropdown.style.display = 'none';
            }
        } catch(e) {}
    },

    async handleNewQuote() {
        const bookTitle = document.getElementById('q-book').value.trim();
        const bookKey = document.getElementById('q-book-key').value.trim();
        const content = document.getElementById('q-content').value.trim();
        const asUsername = document.getElementById('q-as-username').value.trim();
        const errDiv = document.getElementById('quote-error');

        if (!bookTitle || !content) {
            errDiv.innerText = 'Lütfen kitap adı ve alıntı metnini girin.';
            return;
        }

        try {
            const res = await app.apiCall('/forum/quotes', 'POST', {
                book_title: bookTitle,
                book_key: bookKey,
                content: content,
                as_username: asUsername
            });

            if (res.error) throw new Error(res.error);

            app.closeModal('new-quote-modal');
            document.getElementById('new-quote-form').reset();
            app.toast('Alıntı başarıyla eklendi.');

            if (window.location.pathname === '/alintilar') {
                app.loadQuotesFeed();
            }
        } catch (err) {
            errDiv.innerText = err.message;
        }
    },

    async handleQuoteSearch(query) {
        const q = query.toLowerCase().trim();
        const container = document.getElementById('quotes-feed-container');
        
        // 1. Anında Sayfa İçi Filtreleme
        if (app.state.currentQuotes && container) {
            if (!q) {
                app.renderQuotes(app.state.currentQuotes, container);
            } else {
                const filtered = app.state.currentQuotes.filter(c => 
                    (c.book_author && c.book_author.toLowerCase().includes(q)) || 
                    (c.book_title && c.book_title.toLowerCase().includes(q)) || 
                    (c.content && c.content.toLowerCase().includes(q))
                );
                app.renderQuotes(filtered, container);
            }
        }

        const dropdown = document.getElementById('quote-search-dropdown');
        if (!q || q.length < 3) {
            dropdown.classList.add('hidden');
            return;
        }

        // 2. OpenLibrary Araması (Debounce ile)
        clearTimeout(app.searchTimeout);
        app.searchTimeout = setTimeout(async () => {
            dropdown.classList.remove('hidden');
            dropdown.innerHTML = '<div style="padding:15px; text-align:center; color:var(--text-secondary);"><i class="fa-solid fa-circle-notch fa-spin"></i> Global Kütüphanede Aranıyor...</div>';

            try {
            const [authorRes, books] = await Promise.all([
                fetch(`https://openlibrary.org/search/authors.json?q=${encodeURIComponent(query)}&limit=3`).then(r => r.json()),
                app.searchBooks(query, 4)
            ]);

            const authorData = authorRes;

            dropdown.innerHTML = '';
            let hasResults = false;

            if (authorData.docs && authorData.docs.length > 0) {
                hasResults = true;
                const sec = document.createElement('div');
                sec.innerHTML = '<div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:1px; color:var(--accent-gold); padding:8px 15px; background:rgba(197,160,89,0.05); font-weight:bold; border-bottom:1px solid var(--glass-border);">Yazarlar</div>';
                authorData.docs.forEach(a => {
                    const item = document.createElement('div');
                    item.style.cssText = 'padding:12px 15px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; align-items:center; gap:10px; transition:background 0.2s; color:var(--text-primary);';
                    item.onmouseover = () => item.style.background = 'rgba(255,255,255,0.05)';
                    item.onmouseout = () => item.style.background = 'transparent';
                    item.innerHTML = `<i class="fa-solid fa-feather-pointed" style="color:var(--text-secondary); width:16px; text-align:center;"></i> <span>${a.name}</span>`;
                    item.onclick = () => {
                        dropdown.classList.add('hidden');
                        document.getElementById('quote-global-search').value = '';
                        app.handleRoute(`/yazar/${a.key}-${app.slugify(a.name)}`);
                    };
                    sec.appendChild(item);
                });
                dropdown.appendChild(sec);
            }

            if (books.length > 0) {
                hasResults = true;
                const sec = document.createElement('div');
                sec.innerHTML = '<div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:1px; color:var(--accent-gold); padding:8px 15px; background:rgba(197,160,89,0.05); font-weight:bold; border-bottom:1px solid var(--glass-border);">Kitaplar</div>';
                books.forEach(b => {
                    const item = document.createElement('div');
                    item.style.cssText = 'padding:12px 15px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; align-items:center; gap:10px; transition:background 0.2s; color:var(--text-primary);';
                    item.onmouseover = () => item.style.background = 'rgba(255,255,255,0.05)';
                    item.onmouseout = () => item.style.background = 'transparent';
                    item.innerHTML = `<i class="fa-solid fa-book" style="color:var(--text-secondary); width:16px; text-align:center;"></i> <div style="flex:1; min-width:0;"><div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${b.title}</div><div style="font-size:0.8rem; color:var(--text-secondary); margin-top:2px;">${b.author_name ? b.author_name[0] : 'Bilinmeyen Yazar'}</div></div>`;
                    item.onclick = () => {
                        dropdown.classList.add('hidden');
                        document.getElementById('quote-global-search').value = '';
                        app.handleRoute(`/kitap/${b.key.replace('/works/','')}-${app.slugify(b.title)}`);
                    };
                    sec.appendChild(item);
                });
                dropdown.appendChild(sec);
            }

            if (!hasResults) {
                dropdown.innerHTML = '<div style="padding:15px; text-align:center; color:var(--text-secondary);">Global kütüphanede sonuç bulunamadı.</div>';
            }

        } catch(e) {
            dropdown.innerHTML = '<div style="padding:15px; text-align:center; color:#e74c3c;">Arama sırasında büyü bozuldu.</div>';
        }
        }, 600); // 600ms debounce
    },

    async loadQuotesFeed() {
        const container = document.getElementById('quotes-feed-container');
        if (!container) return;
        container.innerHTML = '<div class="loading-pulse">İnciler toplanıyor...</div>';

        try {
            let uid = app.state.user ? app.state.user.id : 0;
            const quotes = await app.apiCall(`/forum/quotes?uid=${uid}`);
            app.state.currentQuotes = quotes; // Filtreleme için kaydet
            app.renderQuotes(quotes, container);
        } catch(e) {
            container.innerHTML = '<div style="color:red;">Alıntılar yüklenemedi.</div>';
        }
    },

    timeAgo(dateStr) {
        const now = new Date();
        const date = new Date(dateStr + 'Z');
        const diff = Math.floor((now - date) / 1000);
        if (diff < 60) return 'az önce';
        if (diff < 3600) return Math.floor(diff / 60) + ' dk önce';
        if (diff < 86400) return Math.floor(diff / 3600) + ' saat önce';
        if (diff < 604800) return Math.floor(diff / 86400) + ' gün önce';
        return date.toLocaleDateString('tr-TR');
    },

    renderQuotes(quotes, container) {
        container.innerHTML = '';
        if (!quotes || quotes.length === 0) {
            container.innerHTML = '<p style="color:var(--text-secondary); font-style:italic; text-align:center; padding:30px;">Henüz hiç alıntı paylaşılmamış. İlk inciyi sen bırak.</p>';
            return;
        }

        quotes.forEach(q => {
            const isLiked = q.is_liked > 0;
            const likeColor = isLiked ? '#e74c3c' : 'var(--text-secondary)';
            const ava = q.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${q.username}`;
            const bookKey = q.book_key ? q.book_key.replace('/works/', '') : '';
            const bookSlug = bookKey ? bookKey + '-' + app.slugify(q.book_title) : '';
            const coverUrl = q.book_cover_url || '';
            const authorName = q.book_author || '';
            const isAdmin = app.state.user && app.state.user.is_admin;
            const authorLink = authorName ? `<span onclick="app.handleRoute('/yazar/${encodeURIComponent(authorName)}')" style="color:var(--text-secondary); text-decoration:none; font-size:0.9rem; border-bottom:1px solid transparent; transition:border-bottom 0.2s; cursor:pointer;" onmouseover="this.style.borderBottom='1px solid var(--text-secondary)';" onmouseout="this.style.borderBottom='1px solid transparent';">— ${authorName}</span>` : '';

            const div = document.createElement('div');
            div.className = 'fade-in';
            div.style.cssText = 'background:var(--bg-surface); border-radius:16px; padding:24px; margin-bottom:8px; border:1px solid var(--glass-border); transition:transform 0.2s, box-shadow 0.2s; position:relative;';
            div.onmouseover = () => { div.style.transform = 'translateY(-2px)'; div.style.boxShadow = '0 8px 30px rgba(0,0,0,0.3)'; };
            div.onmouseout = () => { div.style.transform = 'none'; div.style.boxShadow = 'none'; };

            div.innerHTML = `
                ${isAdmin ? `<button onclick="app.deleteQuote(${q.id})" style="position:absolute; top:15px; right:15px; background:transparent; border:none; color:#e74c3c; cursor:pointer; font-size:1.1rem; padding:5px;"><i class="fa-solid fa-trash"></i></button>` : ''}
                <div style="display:flex; gap:20px;">
                    ${coverUrl ? `<div style="flex-shrink:0; cursor:pointer;" onclick="app.handleRoute('/kitap/${bookSlug}')">
                        <img src="${coverUrl}" 
                             onerror="this.style.display='none';"
                             style="width:75px; height:112px; object-fit:cover; border-radius:8px; border:2px solid var(--glass-border); box-shadow:0 4px 15px rgba(0,0,0,0.4);">
                    </div>` : ''}
                    <div style="flex:1; min-width:0;">
                        <div style="margin-bottom:18px; padding-right:${isAdmin ? '25px' : '0'};">
                            <p style="font-family:'Playfair Display', serif; font-size:1.15rem; font-style:italic; line-height:1.7; margin:0; color:var(--text-primary);">
                                <span style="color:var(--accent-gold); font-size:1.4rem; margin-right:4px;">&ldquo;</span>${q.content}<span style="color:var(--accent-gold); font-size:1.4rem; margin-left:4px;">&rdquo;</span>
                            </p>
                        </div>
                        
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px;">
                            ${bookSlug ? `<span onclick="app.handleRoute('/kitap/${bookSlug}')" style="color:var(--accent-gold); text-decoration:none; font-weight:600; font-size:1rem; border-bottom:1px solid transparent; transition:border-bottom 0.2s; cursor:pointer;" onmouseover="this.style.borderBottom='1px solid var(--accent-gold)';" onmouseout="this.style.borderBottom='1px solid transparent';">
                                <i class="fa-solid fa-book-open" style="margin-right:5px;"></i>${q.book_title}
                            </span>` : `<span style="color:var(--accent-gold); font-weight:600; font-size:1rem;"><i class="fa-solid fa-book-open" style="margin-right:5px;"></i>${q.book_title}</span>`}
                            ${authorLink}
                        </div>

                        <div style="display:flex; align-items:center; justify-content:space-between; padding-top:12px; border-top:1px solid var(--glass-border);">
                            <div style="display:flex; align-items:center; gap:10px; cursor:pointer;" onclick="app.showProfile('${q.username}')">
                                <img src="${ava}" style="width:30px; height:30px; border-radius:50%; border:2px solid var(--glass-border);">
                                <span style="color:var(--text-primary); font-weight:500; font-size:0.95rem;">${q.username}</span>
                                <span style="color:var(--text-secondary); font-size:0.85rem;">${app.timeAgo(q.created_at)}</span>
                            </div>
                            <span id="quote-like-${q.id}" style="cursor:pointer; color:${likeColor}; transition:all 0.2s; font-size:1.05rem; display:flex; align-items:center; gap:5px;" onclick="app.toggleQuoteLike(${q.id})">
                                <i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
                                <span style="font-size:0.95rem;">${q.likes_count}</span>
                            </span>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(div);
        });
    },

    async toggleQuoteLike(quoteId) {
        if (!app.state.user) { app.showModal('auth-modal'); return; }
        try {
            const res = await app.apiCall(`/forum/quotes/${quoteId}/like`, 'POST');
            const el = document.getElementById(`quote-like-${quoteId}`);
            if (!el) return;
            const icon = el.querySelector('i');
            const countSpan = el.querySelector('span');
            let count = parseInt(countSpan.innerText);

            if (res.liked) {
                icon.className = 'fa-solid fa-heart';
                el.style.color = '#e74c3c';
                countSpan.innerText = count + 1;
            } else {
                icon.className = 'fa-regular fa-heart';
                el.style.color = 'var(--text-secondary)';
                countSpan.innerText = count - 1;
            }
        } catch(e) {
            app.toast('Beğeni işlemi başarısız');
        }
    },

    async deleteQuote(quoteId) {
        if (!app.state.user || !app.state.user.is_admin) return;
        if (!confirm('Bu alıntıyı tamamen silmek istediğinize emin misiniz?')) return;
        try {
            await app.apiCall(`/forum/quotes/${quoteId}`, 'DELETE');
            app.toast('Alıntı kütüphaneden silindi.');
            app.loadQuotesFeed();
        } catch(e) { app.toast(e.message); }
    },

    async showQuotesByBook(bookSlug) {
        app.hideAllViews();
        const viewQuotes = document.getElementById('view-quotes');
        if (viewQuotes) viewQuotes.classList.remove('hidden');
        
        const bookKey = bookSlug.split('-')[0];
        const container = document.getElementById('quotes-feed-container');
        container.innerHTML = '<div class="loading-pulse" style="text-align:center; padding:2rem;">Eserin incileri aranıyor...</div>';
        
        const formDiv = document.querySelector('.quote-form');
        if(formDiv) formDiv.style.display = 'none';

        try {
            const uid = app.state.user ? app.state.user.id : 0;
            const quotes = await app.apiCall(`/forum/books/${bookKey}/quotes?uid=${uid}`);
            
            let bTitle = quotes.length > 0 ? quotes[0].book_title : 'Seçili Kitap';
            document.title = `${bTitle} Alıntıları - Okuryazmaz`;
            
            const header = document.createElement('div');
            header.innerHTML = `
                <div style="margin-bottom:20px; padding-bottom:10px; border-bottom:1px solid var(--glass-border); display:flex; justify-content:space-between; align-items:center;">
                    <h2 style="font-family:'Playfair Display'; color:var(--accent-gold); margin:0;">
                        <i class="fa-solid fa-book-open"></i> ${bTitle} Alıntıları
                    </h2>
                    <div>
                        <button class="btn-primary" style="padding:5px 15px; font-size:0.9rem; margin-right:10px; background:transparent; border:1px solid var(--accent-gold); color:var(--accent-gold);" onclick="app.handleRoute('/kitap/${bookSlug}')">Eseri İncele</button>
                        <button class="btn-primary" style="padding:5px 15px; font-size:0.9rem;" onclick="app.showQuotes()">Tümüne Dön</button>
                    </div>
                </div>
            `;
            container.innerHTML = '';
            container.appendChild(header);
            
            if(quotes.length > 0) app.renderQuotes(quotes, container);
            else container.innerHTML += '<p style="color:var(--text-secondary); text-align:center;">Bu esere ait alıntı bulunamadı.</p>';
        } catch(e) {
            container.innerHTML = '<p style="color:#e74c3c; text-align:center;">Alıntılar yüklenemedi.</p>';
        }
    },

    async _loadDynamicAuthorInternal(authorKeyOrName) {
        app.hideAllViews();
        const viewAuthor = document.getElementById('view-dynamic-author');
        if (viewAuthor) viewAuthor.classList.remove('hidden');
        
        const container = document.getElementById('view-dynamic-author-content');
        container.innerHTML = '<div class="loading-pulse" style="text-align:center; padding:4rem;">Yazar bilgileri getiriliyor...</div>';

        try {
            let authorKey = authorKeyOrName;
            
            // Eğer doğrudan isim verildiyse (OL ile başlamıyorsa), önce key bul
            if (!authorKey.startsWith('OL')) {
                const sRes = await fetch(`https://openlibrary.org/search/authors.json?q=${encodeURIComponent(authorKeyOrName)}`);
                const sData = await sRes.json();
                if (sData.docs && sData.docs.length > 0) {
                    authorKey = sData.docs[0].key;
                } else {
                    throw new Error("Yazar bulunamadı");
                }
            }
            
            // Başındaki /authors/ kısmını temizle (eğer varsa)
            authorKey = authorKey.replace('/authors/', '');

            const res = await fetch(`https://openlibrary.org/authors/${authorKey}.json`);
            const author = await res.json();
            
            let name = author.name || 'Bilinmiyor';
            let bioRaw = author.bio ? (typeof author.bio === 'string' ? author.bio : author.bio.value) : 'Yazar hakkında yeterli bilgi bulunamadı.';
            let bioTranslated = bioRaw;
            
            const birth = author.birth_date ? author.birth_date : '?';
            const death = author.death_date ? author.death_date : '';
            const dateStr = death ? `(${birth} - ${death})` : `(d. ${birth})`;
            
            // Çeviri İsteği
            try {
                const transRes = await fetch('/api/forum/translate-book', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: name, description: bioRaw, subjects: '' })
                });
                const transData = await transRes.json();
                if (transData.description) bioTranslated = transData.description;
            } catch (e) {
                console.log("Çeviri başarısız", e);
            }
            
            document.title = `${name} - Hayatı, Eserleri ve Alıntıları | Okuryazmaz`;

            // Kapak/Foto
            const photoHtml = author.photos && author.photos.length > 0 
                ? `<img src="https://covers.openlibrary.org/a/id/${author.photos[0]}-L.jpg" style="width:180px; height:180px; border-radius:50%; object-fit:cover; border:3px solid var(--accent-gold); box-shadow:0 10px 30px rgba(0,0,0,0.5); margin-bottom:20px;">`
                : `<div style="width:150px; height:150px; border-radius:50%; background:var(--bg-card); border:2px solid var(--glass-border); display:flex; align-items:center; justify-content:center; margin:0 auto 20px; font-size:3rem; color:var(--text-secondary);"><i class="fa-solid fa-user-tie"></i></div>`;

            // Html oluştur
            container.innerHTML = `
                <div style="max-width:900px; margin:0 auto;">
                    ${photoHtml}
                    <h1 style="font-family:'Playfair Display', serif; font-size:2.8rem; color:var(--text-primary); margin-bottom:5px;">${name}</h1>
                    <div style="color:var(--accent-gold); font-size:1.1rem; margin-bottom:30px; font-style:italic;">${dateStr !== '(d. ?)' ? dateStr : ''}</div>
                    
                    <div style="background:var(--bg-surface); padding:30px; border-radius:16px; border:1px solid var(--glass-border); text-align:left; line-height:1.8; color:var(--text-secondary); margin-bottom:40px; font-size:1.05rem;">
                        <h3 style="color:var(--text-primary); font-family:'Playfair Display'; margin-bottom:15px; border-bottom:1px solid var(--glass-border); padding-bottom:10px;"><i class="fa-solid fa-feather" style="color:var(--accent-gold);"></i> Biyografi</h3>
                        ${bioTranslated.replace(/\\n/g, '<br>')}
                    </div>
                    
                    <div style="margin-bottom:40px; text-align:left;">
                        <h3 style="color:var(--text-primary); font-family:'Playfair Display'; margin-bottom:20px; border-bottom:1px solid var(--glass-border); padding-bottom:10px;">
                            <i class="fa-solid fa-book-open" style="color:var(--accent-gold);"></i> Yazarın Eserleri
                        </h3>
                        <div id="dynamic-author-works" style="display:flex; flex-wrap:wrap; gap:15px;">
                            <div class="loading-pulse" style="text-align:center; padding:1rem; width:100%;">Eserler kütüphaneden çekiliyor...</div>
                        </div>
                    </div>
                    
                    <div style="display:grid; grid-template-columns: 1fr; gap:30px; text-align:left;">
                        <div>
                            <h3 style="color:var(--text-primary); font-family:'Playfair Display'; margin-bottom:20px; border-bottom:1px solid var(--glass-border); padding-bottom:10px;">
                                <i class="fa-solid fa-quote-left" style="color:var(--accent-gold);"></i> ${name} Alıntıları
                            </h3>
                            <div id="dynamic-author-quotes">
                                <div class="loading-pulse" style="text-align:center; padding:2rem;">Alıntılar aranıyor...</div>
                            </div>
                            <div style="text-align:center; margin-top:15px;">
                                <button class="btn-primary" onclick="app.showQuotesByAuthor('${encodeURIComponent(name)}')">Tüm Alıntılarını Gör</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Yazarın alıntılarını çek
            try {
                const uid = app.state.user ? app.state.user.id : 0;
                const quotes = await app.apiCall(`/forum/quotes/by-author/${encodeURIComponent(name)}?uid=${uid}`);
                const qContainer = document.getElementById('dynamic-author-quotes');
                qContainer.innerHTML = '';
                if(quotes.length > 0) {
                    app.renderQuotes(quotes.slice(0, 3), qContainer); // ilk 3'ü göster
                } else {
                    qContainer.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:1rem; border:1px dashed var(--glass-border); border-radius:8px;">Kütüphanemizde bu yazara ait alıntı bulunmuyor.</p>';
                }
            } catch(e) {
                document.getElementById('dynamic-author-quotes').innerHTML = '<p style="color:#e74c3c;">Alıntılar yüklenirken hata oluştu.</p>';
            }
            
            // Yazarın eserlerini çek
            app._loadAuthorWorks(authorKey);

        } catch(e) {
            container.innerHTML = '<p style="color:#e74c3c; padding:3rem;">Yazar bilgileri bulunamadı.</p>';
        }
    },

    async _loadAuthorWorks(authorKey) {
        const worksContainer = document.getElementById('dynamic-author-works');
        if (!worksContainer) return;
        try {
            const res = await fetch(`https://openlibrary.org/search.json?author=${authorKey}&limit=6&sort=editions`);
            const data = await res.json();
            if (data.docs && data.docs.length > 0) {
                // Yabancı başlıkları Türkçeye çevir
                const hasTurkish = (t) => /[çÇğĞıİöÖşŞüÜ]/.test(t);
                const toTranslate = [];
                const translateIndices = [];
                data.docs.forEach((work, i) => {
                    work.title_original = work.title;
                    if (!hasTurkish(work.title) && /^[a-zA-Z\s\-':,\.!?\d]+$/.test(work.title)) {
                        toTranslate.push(work.title);
                        translateIndices.push(i);
                    }
                });
                if (toTranslate.length > 0) {
                    try {
                        const joined = toTranslate.join(' ||| ');
                        const translated = await app.translateText(joined);
                        const parts = translated.split(/\s*\|\|\|\s*/);
                        translateIndices.forEach((idx, j) => {
                            if (parts[j] && parts[j].trim()) {
                                data.docs[idx].title = parts[j].trim();
                            }
                        });
                    } catch(e) {}
                }

                worksContainer.innerHTML = '';
                data.docs.forEach(work => {
                    const workKey = work.key.replace('/works/', '');
                    const coverUrl = work.cover_i ? `https://covers.openlibrary.org/b/id/${work.cover_i}-M.jpg` : '';
                    
                    const item = document.createElement('div');
                    item.style.cssText = 'width:120px; flex-shrink:0; cursor:pointer; text-align:center; transition:transform 0.2s;';
                    item.onmouseover = () => item.style.transform = 'translateY(-5px)';
                    item.onmouseout = () => item.style.transform = 'none';
                    item.onclick = () => app.handleRoute(`/kitap/${workKey}-${app.slugify(work.title_original || work.title)}`);
                    
                    const imgHtml = coverUrl 
                        ? `<img src="${coverUrl}" style="width:100%; height:180px; object-fit:cover; border-radius:8px; border:1px solid var(--glass-border); box-shadow:0 4px 10px rgba(0,0,0,0.5); margin-bottom:10px;">`
                        : `<div style="width:100%; height:180px; border-radius:8px; background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); display:flex; align-items:center; justify-content:center; margin-bottom:10px; color:var(--text-secondary);"><i class="fa-solid fa-book fa-2x"></i></div>`;
                        
                    item.innerHTML = `
                        ${imgHtml}
                        <div style="font-size:0.9rem; font-weight:500; color:var(--text-primary); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; line-height:1.3;" title="${work.title_original || work.title}">${work.title}</div>
                    `;
                    worksContainer.appendChild(item);
                });
            } else {
                worksContainer.innerHTML = '<div style="color:var(--text-secondary); font-style:italic;">Yazarın kayıtlı eseri bulunamadı.</div>';
            }
        } catch(e) {
            worksContainer.innerHTML = '<div style="color:#e74c3c;">Eserler yüklenirken bir hata oluştu.</div>';
        }
    },

    // Yazarın tüm alıntılarını gör
    async showQuotesByAuthor(authorName) {
        app.hideAllViews();
        const viewQuotes = document.getElementById('view-quotes');
        if (viewQuotes) viewQuotes.classList.remove('hidden');
        
        const container = document.getElementById('quotes-feed-container');
        container.innerHTML = '<div class="loading-pulse">Yazarın alıntıları toplanıyor...</div>';
        
        try {
            const uid = app.state.user ? app.state.user.id : 0;
            const decodedName = decodeURIComponent(authorName);
            const quotes = await app.apiCall(`/forum/quotes/by-author/${encodeURIComponent(decodedName)}?uid=${uid}`);
            app.state.currentQuotes = quotes;
            
            const titleEl = viewQuotes.querySelector('h2');
            if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-quote-left" style="margin-right:10px;"></i> ${decodedName} Alıntıları`;
            
            app.renderQuotes(quotes, container);
        } catch(e) {
            container.innerHTML = '<div style="color:#e74c3c;">Alıntılar yüklenemedi.</div>';
        }
    },

    closeModal(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    }
};

window.onload = app.init;
