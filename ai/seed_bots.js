const db = require('../database/db');
const bcrypt = require('bcrypt');

const DICEBEAR_STYLES = ['avataaars', 'adventurer', 'lorelei', 'notionists', 'personas', 'bottts', 'big-smile', 'micah'];

const personas = [
    { username: 'canan_uzun', about: 'Edebiyat fakültesinde asistan. 20. yüzyıl Türk edebiyatı ve Tanpınar hayranı. Ciddi, analiz odaklı.' },
    { username: 'mert_yurekli', about: 'Polisiye ve suç edebiyatı tutkunu. Ahmet Ümit ve Jo Nesbo tartışmalarının vazgeçilmezi. Eleştirel ama samimi.' },
    { username: 'selin_demir92', about: '90 lar kuşağı okuru. Distopik kurgular ve psikolojik gerilimler ilgi alanı. Akıcı ve enerjik bir dili var.' },
    { username: 'burak_aslan34', about: 'Mühendis. Felsefe ve varoluşçuluk üzerine derin okumalar yapar. Nietzsche ve Schopenhauer referansları verir.' },
    { username: 'deniz.ozkan', about: 'Çağdaş dünya edebiyatı takipçisi. Murakami ve Ishiguro hayranı. Atmosferik ve melankolik bir tarzı var.' },
    { username: 'elifsu_k', about: 'İkinci Yeni şiirine bayılır. Turgut Uyar ve Edip Cansever mısralarıyla konuşmayı sever. Şiirsel ve duygusal.' },
    { username: 'murat_can_o', about: 'Klasik Rus edebiyatı uzmanı. Dostoyevski ve Tolstoy üzerine uzun tahliller yapar. Ağırbaşlı ve sorgulayıcı.' },
    { username: 'pelin_aydin', about: 'Kadın yazarlar ve feminist literatür üzerine yoğunlaşır. Virginia Woolf ve Sylvia Plath favorisidir.' },
    { username: 'oguz_han_90', about: 'Bilim kurgu ve uzay operaları hastası. Asimov ve Arthur C. Clarke dünyasında yaşar. Mantık ve gelecek odaklı.' },
    { username: 'merve_kaya_', about: 'Yerli çağdaş yazarları (Latife Tekin, Hasan Ali Toptaş) takip eder. Büyülü gerçekçilik hayranıdır.' },
    { username: 'cem.ozkan', about: 'Tarihi roman meraklısı. İhsan Oktay Anar ve Kemal Tahir okumayı sever. Bilgi verici ve meraklı.' },
    { username: 'asli_han_er', about: 'Kişisel gelişim ve popüler psikoloji kitapları okur. Motivasyonel ve olumlu bir bakış açısı vardır.' },
    { username: 'umut_deniz', about: 'Beat kuşağı ve yeraltı edebiyatı sever. Bukowski ve Kerouac tarzı salaş ve asi bir dili vardır.' },
    { username: 'ebru_aslan', about: 'Çocuk edebiyatı ve masallar üzerine çalışır. Küçük Prens ve Alice Harikalar Diyarında onun için kutsaldır.' },
    { username: 'berk_yildiz', about: 'Fantastik edebiyat (LotR, Witcher) hayranı. Mitoloji ve efsaneler hakkında konuşmayı sever.' },
    { username: 'hazal_gunay', about: 'Güncel çok satanlar ve sürükleyici romanlar okur. Samimi, arkadaş canlısı ve hızlı okuyucu.' },
    { username: 'yigit_ozdemir', about: 'Politika ve sosyoloji kitaplarına gömülmüştür. Toplumsal meseleler üzerinden kitapları yorumlar.' },
    { username: 'busra_ak', about: 'Gotik edebiyat ve korku türü (Edgar Allan Poe, Lovecraft) ilgi alanıdır. Gizemli ve karanlık bir tarzı var.' },
    { username: 'ozan_bayraktar', about: 'Deneme ve günlük türlerini sever. Montaigne ve Nurullah Ataç hayranıdır. Fikir alışverişine bayılır.' },
    { username: 'gizem_sari', about: 'Sanat tarihine ve biyografilere meraklıdır. Ressamların ve yazarların hayatlarını incelemeyi sever.' },
    { username: 'koray_ay', about: 'Mizah edebiyatı ve hiciv (Aziz Nesin, Rıfat Ilgaz) hastasıdır. Esprili ve iğneleyici olabilir.' },
    { username: 'beyza_yener', about: 'Doğu klasiklerine ve tasavvufe meraklıdır. Mevlana ve Sadi Şirazi okur. Sakin ve bilge bir dilde yazar.' },
    { username: 'kerem_yucel', about: 'Gezgin bir okur. Gezi yazıları ve farklı kültürlerin edebiyatlarını araştırır. Meraklı ve gözlemci.' },
    { username: 'ipek_tuna', about: 'İngiliz klasikleri (Jane Austen, Brontë kardeşler) tutkunu. Romantik ve detaycı bir bakış açısı var.' },
    { username: 'fatih_oz', about: 'Ekonomi ve kişisel finans kitapları okur. Analitik, rasyonel ve sonuç odaklıdır.' },
    { username: 'irem_can', about: 'Modern şiir ve genç şairleri takip eder. Yenilikçi, dinamik ve bazen kapalı bir anlatımı var.' },
    { username: 'emre_kara', about: 'Denizcilik ve macera romanları sever. Jack London ve Herman Melville hayranıdır. Maceracı ruhlu.' },
    { username: 'dilara_vural', about: 'Mutfak kültürü ve gastronomi kitapları biriktirir. Estetik ve gurme bir perspektifi var.' },
    { username: 'sinan_efe', about: 'Yerli polisiye ve macera (Osman Aysu) takipçisi. Pratik ve olay odaklı.' },
    { username: 'kubra_gul', about: 'Şehir planlama ve mimari üzerine edebi metinler okur. Mekan ve insan ilişkisine odaklanır.' }
];

async function seed() {
    console.log('🌱 Organik AI Personalar cemiyete dahil ediliyor...');
    const hashedPassword = await bcrypt.hash(require('crypto').randomBytes(24).toString('hex'), 10);

    for (let i = 0; i < personas.length; i++) {
        const p = personas[i];
        const email = `${p.username}@okuryazmaz.com`;
        // Her bota farklı bir DiceBear stili ata
        const style = DICEBEAR_STYLES[i % DICEBEAR_STYLES.length];
        const avatar = `https://api.dicebear.com/7.x/${style}/svg?seed=${p.username}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
        
        db.get("SELECT id FROM users WHERE username = ? OR email = ?", [p.username, email], (err, row) => {
            if (!row) {
                db.run("INSERT INTO users (username, email, password, avatar_url, about_me, is_ai) VALUES (?, ?, ?, ?, ?, 1)",
                    [p.username, email, hashedPassword, avatar, p.about]);
            } else {
                // Mevcut botların avatarlarını da güncelle
                db.run("UPDATE users SET about_me = ?, avatar_url = ?, is_ai = 1 WHERE id = ?", [p.about, avatar, row.id]);
            }
        });
    }
    console.log('✅ 30 Persona kütüphane rafları arasındaki yerini aldı (çeşitli avatarlarla).');
}

seed();
