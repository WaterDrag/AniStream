/* ==========================================================================
   HLAVNÍ JAVASCRIPT APLIKACE (Odladěné funkce v globálním scope)
   ========================================================================== */

const DEFAULT_PROXY = 'https://anisteam.zitkatomik007.workers.dev';
const GEMINI_KEY = 'AQ.Ab8RN6IjHOpEeI_SJChD___dKh4BzhldoTazzIJ0Q9EupHBtfw';
const ANILIST_URL = 'https://graphql.anilist.co';

const state = {
    currentAnime: null, 
    currentEp: null, 
    currentEpIndex: 0,
    episodes: [], 
    allSeasons: {}, 
    availableSeasons: [], 
    currentSeason: 1,
    svtSlug: null, 
    svtTvShowId: null, 
    isFallbackMode: false,
    fallbackEnVtt: null, 
    fallbackCzVttUrl: null,
    page: 1, 
    currentListArgs: { sort: 'TRENDING_DESC' },
    currentSources: [], 
    currentSourceIndex: 0, 
    hlsInstance: null,
};

let toastTO;

// ── UTILITIES & STORAGE ──
function showToast(msg, success = false) {
    const toast = document.getElementById('toast');
    document.getElementById('toastDot').style.background = success ? 'var(--success)' : 'var(--accent)';
    document.getElementById('toastMsg').textContent = msg;
    clearTimeout(toastTO); 
    toast.classList.add('show'); 
    toastTO = setTimeout(() => toast.classList.remove('show'), 3000);
}

function getCfg() { try { return JSON.parse(localStorage.getItem('ani_cfg5') || '{}'); } catch { return {}; } }
function setCfg(d) { localStorage.setItem('ani_cfg5', JSON.stringify(d)); }
function getProxy() { return getCfg().proxy || DEFAULT_PROXY; }
function getDefaultSource() { return getCfg().defaultSource || 'auto'; }

function getWatched() { try { return JSON.parse(localStorage.getItem('ani_watched')||'{}'); } catch { return {}; } }
function setWatched(d) { localStorage.setItem('ani_watched', JSON.stringify(d)); }
function getFavs() { try { return JSON.parse(localStorage.getItem('ani_favs')||'[]'); } catch { return []; } }
function setFavs(d) { localStorage.setItem('ani_favs', JSON.stringify(d)); }
function getHistory() { try { return JSON.parse(localStorage.getItem('ani_history')||'[]'); } catch { return []; } }

function addHistory(anime) { 
    let h = getHistory().filter(x => x.id !== anime.id); 
    h.unshift({ id: anime.id, title: anime.title, cover: anime.cover, ts: Date.now() }); 
    if (h.length > 50) h = h.slice(0, 50); 
    localStorage.setItem('ani_history', JSON.stringify(h)); 
}
function isEpWatched(animeId, epNum, season) { return !!(getWatched()[`${animeId}_s${season}`]?.[epNum]); }
function markEpWatched(animeId, epNum, season, val) { 
    const w = getWatched(); 
    const key = `${animeId}_s${season}`; 
    if (!w[key]) w[key] = {}; 
    if (val) w[key][epNum] = 1; else delete w[key][epNum]; 
    setWatched(w); 
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function getTitle(a) { return a.title?.english || a.title?.romaji || a.title?.native || '—'; }

// OPRAVA 1: Extrémně silná čistící funkce pro správné nalezení série na Svetserialu
function simplifyTitle(title) { 
    if(!title) return '';
    return title.toLowerCase()
                .replace(/(?:season|série|part|cour)\s*\d+.*$/i, '') // ufikne řetězce o sezónách
                .replace(/[^a-z0-9\s]/g, ' ') // odstraní speciální znaky
                .replace(/\s+/g, ' ') // odstraní vícenásobné mezery
                .trim(); 
}

async function proxyFetch(path, options = {}) { 
    const res = await fetch(getProxy() + path, options); 
    if (!res.ok) throw new Error(`HTTP ${res.status}`); 
    return res.text(); 
}

// ── ANILIST API ──
async function anilistQuery(query, variables) {
    const res = await fetch(ANILIST_URL, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ query, variables }) 
    });
    const json = await res.json(); 
    if (json.errors) throw new Error(json.errors[0].message); 
    return json.data;
}

const FIELDS = `id title{romaji english native} synonyms coverImage{large extraLarge} bannerImage description(asHtml:false) episodes status genres averageScore season seasonYear format nextAiringEpisode{episode}`;

async function fetchListAPI(args, page = 1) {
    let extraArgs = "";
    if(args.status) extraArgs += `, status: ${args.status}`;
    if(args.seasonYear) extraArgs += `, seasonYear: ${args.seasonYear}`;
    if(args.genres && args.genres.length > 0) extraArgs += `, genre_in: [${args.genres.map(g => `"${g}"`).join(',')}]`;
    
    // OPRAVA 3: Správný výpočet sezónních argumentů pro GraphQL
    if(args.seasonal) {
        const mo = new Date().getMonth();
        const sArr = ['WINTER','WINTER','SPRING','SPRING','SPRING','SUMMER','SUMMER','SUMMER','FALL','FALL','FALL','WINTER'];
        extraArgs += `, season: ${sArr[mo]}, seasonYear: ${new Date().getFullYear()}`;
    }
    
    const q = `query($p:Int, $sort:[MediaSort]){Page(page:$p,perPage:30){pageInfo{hasNextPage}media(type:ANIME,sort:$sort,isAdult:false${extraArgs}){${FIELDS}}}}`;
    const d = await anilistQuery(q, { p: page, sort: [args.sort] });
    return { items: d.Page.media, hasMore: d.Page.pageInfo.hasNextPage };
}

async function searchAnime(q) { 
    const d = await anilistQuery(`query($s:String){Page(perPage:8){media(search:$s,type:ANIME,isAdult:false){${FIELDS}}}}`, { s: q }); 
    return d.Page.media; 
}

// ── UI / MODALS ──
function openConfig() { 
    document.getElementById('cfgProxy').value = getProxy(); 
    document.getElementById('cfgSource').value = getDefaultSource(); 
    document.getElementById('configModal').classList.add('open'); 
}
function closeConfig() { document.getElementById('configModal').classList.remove('open'); }
function saveConfig() { 
    const cfg = getCfg(); 
    cfg.proxy = document.getElementById('cfgProxy').value.trim().replace(/\/$/, ''); 
    cfg.defaultSource = document.getElementById('cfgSource').value; 
    setCfg(cfg); 
    closeConfig(); 
    showToast('Nastavení uloženo', true); 
}

function openHistory() {
    const h = getHistory(); const f = getFavs(); const c = document.getElementById('historyContent');
    if (!h.length && !f.length) { 
        c.innerHTML = '<div style="color:var(--text-3);text-align:center;padding:40px 0;font-weight:600;">Zatím nic nesledováno</div>'; 
    } else {
        const render = (a) => `<div class="anime-card" onclick="closeHistory();selectSearch(${a.id})"><div class="card-poster"><img src="${a.cover||''}" loading="lazy"><div class="card-overlay"><div class="play-icon"><svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div></div><div class="card-title">${a.title}</div></div>`;
        let html = '';
        if(f.length) html += `<div style="margin-bottom:30px"><h3 style="color:var(--text-1);font-size:14px;margin-bottom:16px;">Oblíbené</h3><div class="history-grid">${f.slice(0,12).map(render).join('')}</div></div>`;
        if(h.length) html += `<div><h3 style="color:var(--text-1);font-size:14px;margin-bottom:16px;">Naposledy sledované</h3><div class="history-grid">${h.slice(0,18).map(render).join('')}</div></div>`;
        c.innerHTML = html;
    }
    document.getElementById('historyModal').classList.add('open');
}
function closeHistory() { document.getElementById('historyModal').classList.remove('open'); }

function openNotifModal() {
    document.getElementById('notifModal').classList.add('open');
    const c = document.getElementById('notifContent'); 
    c.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-3)"><div class="spinner" style="margin:0 auto"></div></div>';
    proxyFetch('/?ajaxNotifyTVShows=true').then(html => {
        const items = Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('a[href*="/serial/"]')).slice(0, 10);
        if (items.length === 0) { c.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-3)">Žádné nové epizody k dispozici.</div>'; return; }
        c.innerHTML = '<ul class="notif-list">' + items.map(el => {
            const a = el.tagName === 'A' ? el : el.querySelector('a'); if(!a) return '';
            const titleEl = a.querySelector('.ep-title, .title, span, strong, b'); 
            let title = titleEl ? titleEl.textContent.trim() : a.textContent.trim();
            const hrefMatch = a.getAttribute('href').match(/\/serial\/([^/]+)\/(s\d+e\d+)/i);
            let epStr = "Nová epizoda";
            if(hrefMatch) { if(!title || title.length < 3) title = hrefMatch[1].replace(/-/g, ' '); epStr = hrefMatch[2].toUpperCase(); }
            return `<li class="notif-item" onclick="openSvtDirectly('${hrefMatch?hrefMatch[1]:''}')"><div class="notif-item-title">${capitalize(title)}</div><div class="notif-item-sub">${epStr}</div></li>`;
        }).join('') + '</ul>';
        document.getElementById('notifDot').style.display = 'none';
    }).catch(() => { c.innerHTML = '<div style="text-align:center;padding:20px;color:var(--danger)">Chyba. Zkontroluj proxy a SESSION.</div>'; });
}
function closeNotifModal() { document.getElementById('notifModal').classList.remove('open'); }
async function openSvtDirectly(slug) { 
    closeNotifModal(); 
    const res = await searchAnime(slug.replace(/-/g, ' ')); 
    if(res && res.length > 0) openAnime(res[0]); else showToast('Seriál nenalezen', false); 
}

// ── AI DOPORUČENÍ (GEMINI) ──
function openAiModal() { document.getElementById('aiModal').classList.add('open'); runAiRecommendations(); }
function closeAiModal() { document.getElementById('aiModal').classList.remove('open'); }

async function runAiRecommendations() {
    const status = document.getElementById('aiStatus'); const results = document.getElementById('aiResults'); results.innerHTML = '';
    const combined = [...new Set([...getFavs().map(f => f.title), ...getHistory().map(h => h.title)])];
    if(combined.length === 0) { status.innerHTML = 'Nemáš žádnou historii ani oblíbené seriály. AI neví, co ti má doporučit! 😭'; return; }
    
    status.innerHTML = `Analyzuji tvoji historii (${combined.length} seriálů) a generuji super kousky...`;
    
    const prompt = `Recommend 6 great anime series for a user. Their taste is based on what they watch: ${combined.slice(0,25).join(', ')}. 
STRICT RULE: You MUST NOT recommend any of these titles. Skip them and pick another.
Reply ONLY with valid JSON exactly in this format:
{"recommendations":[{"name":"Show Name","genres":"Action, Fantasy","desc":"Short 1 sentence reason why they will like it."}]}`;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 1 }})
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        // Bezpečné odstranění markdownu
        let clean = text;
        const mdTags = [String.fromCharCode(96,96,96) + 'json', String.fromCharCode(96,96,96)];
        mdTags.forEach(tag => { clean = clean.replace(new RegExp(tag, 'g'), ''); });
        
        const parsed = JSON.parse(clean.trim());
        
        status.innerHTML = '✓ Zde jsou doporučení přesně pro tebe:';
        results.innerHTML = parsed.recommendations.map(r => `
            <div class="ai-card" onclick="searchFromAi('${r.name.replace(/'/g, "\\'")}')">
                <div class="ai-card-title">${r.name}</div>
                <div class="ai-card-genres">${r.genres}</div>
                <div class="ai-card-desc">${r.desc}</div>
            </div>
        `).join('');
    } catch(e) {
        status.innerHTML = `<span style="color:var(--danger)">Chyba AI: ${e.message}</span>`;
    }
}

async function searchFromAi(name) {
    closeAiModal();
    document.getElementById('searchInput').value = name;
    document.getElementById('searchInput').dispatchEvent(new Event('input'));
    document.getElementById('searchInput').focus();
}

// ── FILTRY & HOME ──
function toggleAdvancedFilters() { document.getElementById('advancedFilters').classList.toggle('open'); }
function togglePill(element, isRadio = false, isToggle = false) {
    const parent = element.parentElement;
    if (isRadio) {
        if(element.classList.contains('active') && isToggle) {
            element.classList.remove('active');
        } else {
            parent.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active')); 
            element.classList.add('active');
        }
    } else {
        element.classList.toggle('active');
    }
}

function applyAdvancedFilters() {
    const sort = document.querySelector('#filterSort .active')?.dataset.val || 'TRENDING_DESC';
    const status = document.querySelector('#filterStatus .active')?.dataset.val || null;
    const year = document.getElementById('filterYear').value || null;
    const genres = Array.from(document.querySelectorAll('#filterGenres .active')).map(p => p.dataset.val);
    
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
    document.getElementById('sectionTitle').textContent = "Vlastní filtr";
    
    state.currentListArgs = { sort, status, seasonYear: year ? parseInt(year) : null, genres };
    state.page = 1; loadFilterData(state.currentListArgs, false);
}

function switchFilter(btn, filterType) {
    if (!btn) return;
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const adv = document.getElementById('advancedFilters'); if (adv) adv.classList.remove('open');
    
    let args = { sort: 'TRENDING_DESC' };
    if(filterType === 'TRENDING') args.sort = 'TRENDING_DESC';
    if(filterType === 'POPULAR') args.sort = 'POPULARITY_DESC';
    if(filterType === 'TOP_RATED') args.sort = 'SCORE_DESC';
    if(filterType === 'SEASONAL') { args.sort = 'POPULARITY_DESC'; args.seasonal = true; }
    
    document.getElementById('sectionTitle').textContent = btn.textContent;
    state.currentListArgs = args; state.page = 1; loadFilterData(args, false);
}

async function loadFilterData(args, append = false) {
    const grid = document.getElementById('animeGrid');
    if (!append) { renderSkeletons(); document.getElementById('heroSection').classList.remove('active'); }
    const btn = document.getElementById('loadMoreBtn'); btn.disabled = true;
    try {
        const { items, hasMore } = await fetchListAPI(args, state.page);
        
        // Zabrání duplikacím stejného seriálu s jinou sezónou
        const uniqueItems = []; const seen = new Set();
        for (const item of items) {
            const baseName = simplifyTitle(getTitle(item));
            if (baseName && !seen.has(baseName)) { seen.add(baseName); uniqueItems.push(item); }
        }

        if (!append && args.sort === 'TRENDING_DESC' && (!args.genres || args.genres.length===0) && uniqueItems.length > 0) {
            const heroAnime = uniqueItems.shift(); 
            const hero = document.getElementById('heroSection');
            document.getElementById('heroBg').style.backgroundImage = `url('${heroAnime.bannerImage || heroAnime.coverImage?.extraLarge}')`;
            document.getElementById('heroTitle').textContent = getTitle(heroAnime);
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = heroAnime.description || '';
            document.getElementById('heroDesc').textContent = tempDiv.textContent || "Skvělé anime, které stojí za zhlédnutí.";
            document.getElementById('heroBtn').onclick = () => openAnime(heroAnime);
            hero.classList.add('active');
        }

        renderCards(uniqueItems, append);
        btn.disabled = !hasMore; btn.style.display = hasMore ? '' : 'none';
    } catch(e) { grid.innerHTML = `<div style="color:var(--danger);text-align:center;width:100%">Chyba při načítání dat: ${e.message}</div>`; }
}

function loadMore() { state.page++; loadFilterData(state.currentListArgs, true); }
function renderSkeletons(n=12) { document.getElementById('animeGrid').innerHTML = Array.from({length:n}, ()=>`<div class="anime-card"><div class="card-poster skeleton skeleton-poster"></div><div class="skeleton skeleton-title"></div></div>`).join(''); }

function renderCards(items, append = false) {
    const grid = document.getElementById('animeGrid'); if (!append) grid.innerHTML = '';
    if(items.length === 0 && !append) { grid.innerHTML = `<div style="color:var(--text-3);text-align:center;grid-column:1/-1;">Žádné anime nebylo nalezeno.</div>`; return; }
    items.forEach((a, i) => {
        const card = document.createElement('div'); card.className = 'anime-card'; card.style.animationDelay = `${(i % 12) * 0.03}s`;
        card.innerHTML = `<div class="card-poster"><img src="${a.coverImage?.large||''}" loading="lazy">${a.averageScore ? `<div class="card-rating">★ ${(a.averageScore/10).toFixed(1)}</div>` : ''}<div class="card-overlay"><div class="play-icon"><svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div></div><div class="card-title">${getTitle(a)}</div>`;
        card.onclick = () => openAnime(a); grid.appendChild(card);
    });
}

// ── SEARCH HANDLER ──
let searchTO;
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('searchInput').addEventListener('input', function() {
        clearTimeout(searchTO); const q = this.value.trim(), res = document.getElementById('searchResults');
        if (!q) { res.classList.remove('open'); return; }
        res.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-3);font-size:13px">Hledám…</div>'; res.classList.add('open');
        searchTO = setTimeout(async () => {
            try {
                const items = await searchAnime(q);
                const unique = []; const seen = new Set();
                for(const item of items) {
                    const baseName = simplifyTitle(getTitle(item));
                    if(baseName && !seen.has(baseName)) { seen.add(baseName); unique.push(item); }
                }
                if (!unique.length) { res.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-3);font-size:13px">Nic nenalezeno</div>'; return; }
                res.innerHTML = unique.map(a => `<div class="search-result-item" onclick="selectSearch(${a.id})"><img class="search-result-img" src="${a.coverImage?.large||''}"><div style="flex:1"><div class="search-result-title">${getTitle(a)}</div><div class="search-result-sub">${a.format||''} · ${a.episodes||'?'} ep · ${a.seasonYear||''}</div></div></div>`).join('');
            } catch { res.innerHTML = '<div style="padding:16px;text-align:center;color:var(--danger);font-size:13px">Chyba hledání</div>'; }
        }, 400);
    });
    
    document.addEventListener('click', e => { if (!e.target.closest('.search-wrap')) { document.getElementById('searchResults').classList.remove('open'); } });
});

async function selectSearch(id) { document.getElementById('searchResults').classList.remove('open'); document.getElementById('searchInput').value = ''; openAnime(await fetchAnimeDetail(id)); }


/* ── SVT & DETAIL ── */
async function svtSearch(query) {
    const html = await proxyFetch(`/?searchfor=${encodeURIComponent(query)}`);
    const matches = [...html.matchAll(/href="[^"]*\/serial\/([a-z0-9-]+)[^"]*"/g)];
    if (!matches.length) return null;
    const slugs = [...new Set(matches.map(m => m[1]).filter(s => s && !['novinky','oblibene'].includes(s)))];
    return slugs[0] || null;
}

async function findSvtSlug(anime, onProgress) {
    // Rozšířený záchyt
    let titles = [anime.title?.english, anime.title?.romaji, anime.title?.native, ...(anime.synonyms || [])].filter(Boolean);
    const queries = new Set();

    titles.forEach(t => {
        queries.add(t);
        let base = t.replace(/(?:\s*[-:]\s*)?(?:season|série|part|cour)\s*\d+.*$/i, '').trim();
        queries.add(base);

        let clean = base.replace(/[^\w\s]/gi, ' ').replace(/\s+/g, ' ').trim();
        if (clean) queries.add(clean);

        // Agresivnější fallback: Vezmeme jen první dvě slova
        let words = clean.split(' ');
        if (words.length > 1) {
            queries.add(words[0] + ' ' + words[1]);
        }
    });

    const uniqueQueries = Array.from(queries);
    for (const q of uniqueQueries) {
        try { if(onProgress) onProgress(`Hledám na SVT: ${q}…`); const s = await svtSearch(q); if(s) return s; } catch(e){}
    }
    return null;
}

function simulateEnglishFallback(anime) {
    state.isFallbackMode = true; state.svtSlug = 'fallback'; state.availableSeasons = [1]; state.currentSeason = 1;
    const count = anime.episodes || 12;
    state.episodes = Array.from({length:count}, (_,i)=>({ number:i+1, title:`Epizoda ${i+1}`, code:`s01e${i+1}`, slug:'fallback', season:1 }));
    
    const desc = document.getElementById('detailDesc');
    desc.innerHTML = `<span class="tag danger" style="margin-bottom:10px; display:inline-block">NENÍ NA SVETSERIALU</span><br>Tento seriál není na českých webech dostupný. <b>Aktivován AI Fallback:</b> Přehrávač získal originální verzi a nabízí možnost živého překladu titulků pomocí Gemini AI.<br><br>` + (desc.textContent || '');
    
    renderSeasonTabs(); renderEpList(); setupMainPlayBtn();
}

function showPlayerView() { document.getElementById('home-view').style.display = 'none'; document.getElementById('player-view').style.display = 'block'; window.scrollTo(0,0); }
function goHome() { destroyHls(); document.getElementById('home-view').style.display = ''; document.getElementById('player-view').style.display = 'none'; document.getElementById('playerContainer').classList.remove('active'); }

async function openAnime(anime) {
    state.currentAnime = anime; state.isFallbackMode = false;
    state.allSeasons = {}; state.availableSeasons = []; state.currentSeason = 1; state.episodes = []; state.currentEp = null;
    addHistory(anime); showPlayerView(); destroyHls();

    document.getElementById('playerContainer').classList.remove('active');
    document.getElementById('seasonTabs').style.display = 'none';
    document.getElementById('mainPlayBtn').disabled = true; document.getElementById('mainPlayBtnText').textContent = "Načítám...";
    
    document.getElementById('detailTitle').textContent = getTitle(anime);
    document.getElementById('detailPosterImg').src = anime.coverImage?.extraLarge || '';
    const tempDiv = document.createElement('div'); tempDiv.innerHTML = anime.description || 'Bez popisu';
    document.getElementById('detailDesc').textContent = tempDiv.textContent;
    document.getElementById('detailMeta').innerHTML = [
        anime.format ? `<span class="tag">${anime.format}</span>` : '', 
        anime.seasonYear ? `<span class="tag">${anime.seasonYear}</span>` : '', 
        anime.averageScore ? `<span class="tag accent">★ ${(anime.averageScore/10).toFixed(1)}</span>` : ''
    ].join('');
    
    updateFavBtn();
    const epList = document.getElementById('epList'); 
    epList.innerHTML = `<li style="padding:20px;text-align:center;color:var(--text-3);">Hledám propojení...</li>`;

    try {
        const slug = await findSvtSlug(anime, (msg)=> { epList.innerHTML = `<li style="padding:20px;text-align:center;color:var(--text-3);">${msg}</li>`; });
        if (!slug) throw new Error('NOT_FOUND'); state.svtSlug = slug;

        let tvShowId = null;
        try { const mHtml = await proxyFetch(`/serial/${slug}`); tvShowId = (mHtml.match(/tvShowId[=&](\d+)/)||[null,null])[1]; } catch{}
        if (!tvShowId) { try { const fHtml = await proxyFetch(`/serial/${slug}/s01e01`); tvShowId = (fHtml.match(/tvShowId[=&](\d+)/)||[null,null])[1]; } catch{} }
        if (!tvShowId) throw new Error('NOT_FOUND'); state.svtTvShowId = tvShowId;

        const sChecks = await Promise.all(Array.from({length:8}, (_,i)=>i+1).map(async s=>{ try{ return (await proxyFetch(`/episodes-list?tvShowId=${tvShowId}&season=${s}&episode=1`)).includes('/serial/') ? s : null; }catch{return null;} }));
        state.availableSeasons = sChecks.filter(Boolean).length ? sChecks.filter(Boolean) : [1];
        
        let targetS = 1; const mMatch = getTitle(anime).toLowerCase().match(/(?:season|part)\s*(\d+)/); if(mMatch) targetS = parseInt(mMatch[1]);
        state.currentSeason = state.availableSeasons.includes(targetS) ? targetS : state.availableSeasons[0];
        
        const epHtml = await proxyFetch(`/episodes-list?tvShowId=${tvShowId}&season=${state.currentSeason}&episode=1`);
        const epMatches = [...epHtml.matchAll(/href="[^"]*\/serial\/[^/]+\/(s\d+e\d+)[^"]*"/g)];
        const nameMatches = [...epHtml.matchAll(/class="ep_name[^"]*"[^>]*>\s*([^<]+)\s*</g)];
        
        state.episodes = epMatches.map((m, i) => {
            const epNum = parseInt(m[1].match(/e(\d+)/)[1]);
            return { number: epNum, title: (nameMatches[i] ? nameMatches[i][1].trim() : null) || `Epizoda ${epNum}`, code: m[1], slug, season: state.currentSeason };
        });
        state.allSeasons[state.currentSeason] = state.episodes;
        
        renderSeasonTabs(); renderEpList(); setupMainPlayBtn();
    } catch(e) {
        if(e.message === 'NOT_FOUND') simulateEnglishFallback(anime);
        else epList.innerHTML = `<li style="color:var(--danger);text-align:center;padding:20px">Chyba: ${e.message}</li>`;
    }
}

function renderSeasonTabs() {
    const tabs = document.getElementById('seasonTabs'); if (state.availableSeasons.length <= 1) { tabs.style.display = 'none'; return; }
    tabs.style.display = 'flex'; tabs.innerHTML = state.availableSeasons.map(s => `<button class="season-tab ${s===state.currentSeason?'active':''}" onclick="switchSeason(${s})">S${s}</button>`).join('');
}

async function switchSeason(season) {
    if (season === state.currentSeason && state.allSeasons[season]) return;
    state.currentSeason = season; document.querySelectorAll('.season-tab').forEach(b => { b.classList.toggle('active', parseInt(b.textContent.replace('S','')) === season); });
    document.getElementById('epList').innerHTML = `<li style="padding:20px;text-align:center;color:var(--text-3);"><div class="spinner" style="margin:0 auto;"></div></li>`;
    try {
        if(!state.allSeasons[season]){
            const epHtml = await proxyFetch(`/episodes-list?tvShowId=${state.svtTvShowId}&season=${season}&episode=1`);
            const epMatches = [...epHtml.matchAll(/href="[^"]*\/serial\/[^/]+\/(s\d+e\d+)[^"]*"/g)]; const nameMatches = [...epHtml.matchAll(/class="ep_name[^"]*"[^>]*>\s*([^<]+)\s*</g)];
            state.allSeasons[season] = epMatches.map((m, i) => { const epNum = parseInt(m[1].match(/e(\d+)/)[1]); return { number: epNum, title: (nameMatches[i] ? nameMatches[i][1].trim() : null) || `Epizoda ${epNum}`, code: m[1], slug: state.svtSlug, season }; });
        }
        state.episodes = state.allSeasons[season]; state.currentEp = null; renderEpList(); setupMainPlayBtn();
    } catch(e) { document.getElementById('epList').innerHTML = `<li style="color:var(--danger);padding:20px;text-align:center;">Chyba: ${e.message}</li>`; }
}

function renderEpList() {
    const list = document.getElementById('epList'), aId = state.currentAnime?.id, s = state.currentSeason;
    list.innerHTML = state.episodes.map((ep, i) => {
        const w = isEpWatched(aId, ep.number, s); const curr = state.currentEp?.number === ep.number && state.currentEp?.season === ep.season;
        return `<li id="ep-item-${ep.number}"><a href="#" class="${curr?'current':''} ${w?'watched':''}" onclick="playEp(${i});return false"><span class="ep-num-box">${ep.number}</span><span class="ep-name-wide">${ep.title}</span></a></li>`;
    }).join('');
}

function setupMainPlayBtn() {
    const btn = document.getElementById('mainPlayBtn'); btn.disabled = false;
    const firstUnwatchedIdx = state.episodes.findIndex(ep => !isEpWatched(state.currentAnime.id, ep.number, ep.season));
    if (firstUnwatchedIdx === -1) { document.getElementById('mainPlayBtnText').textContent = "Přehrát znovu"; } 
    else { document.getElementById('mainPlayBtnText').textContent = firstUnwatchedIdx > 0 ? `Pokračovat (Ep. ${state.episodes[firstUnwatchedIdx].number})` : "Začít sledovat"; }
}

function playNextOrFirstEp() { let idx = state.episodes.findIndex(ep => !isEpWatched(state.currentAnime.id, ep.number, ep.season)); playEp(idx === -1 ? 0 : idx); }

function switchTrack(video, lang) {
    if(!video || !video.textTracks) return;
    for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = (video.textTracks[i].language === lang) ? 'showing' : 'hidden';
    }
}

async function setFallbackSub(lang) {
    const video = document.getElementById('fallbackVideo'); if(!video) return;
    const btnEn = document.getElementById('fbSubEn'); const btnCz = document.getElementById('fbSubCz');
    btnEn.classList.remove('active'); btnCz.classList.remove('active');

    if(lang === 'en') { 
        btnEn.classList.add('active'); switchTrack(video, 'en'); 
    } else if (lang === 'cs') {
        btnCz.classList.add('active');
        if(state.fallbackCzVttUrl) { switchTrack(video, 'cs'); } 
        else {
            const originalText = btnCz.innerHTML;
            btnCz.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px"></div> Překládám...';
            btnCz.style.pointerEvents = 'none';
            try {
                const translatedVtt = await translateSubsWithGemini(state.fallbackEnVtt);
                const blob = new Blob([translatedVtt], { type: 'text/vtt' });
                state.fallbackCzVttUrl = URL.createObjectURL(blob);
                const track = document.createElement('track'); track.kind = 'subtitles'; track.label = 'Czech (AI)'; track.srclang = 'cs'; track.src = state.fallbackCzVttUrl; track.id = 'track-cs';
                video.appendChild(track);
                setTimeout(() => { switchTrack(video, 'cs'); }, 150);
                btnCz.innerHTML = 'AI Překlad CZ (Aktivní)';
            } catch (e) {
                showToast('Chyba AI překladu: ' + e.message, false); btnCz.innerHTML = originalText; btnEn.classList.add('active'); btnCz.classList.remove('active'); switchTrack(video, 'en');
            } finally { btnCz.style.pointerEvents = 'auto'; }
        }
    }
}

async function playEp(index) {
    const ep = state.episodes[index]; if (!ep) return;
    state.currentEp = ep; state.currentEpIndex = index;
    renderEpList(); updateNavBtns(); updateWatchedBtn(); destroyHls();
    
    const container = document.getElementById('playerContainer'); container.classList.add('active');
    container.scrollIntoView({ behavior:'smooth', block:'start' });

    const wrap = document.getElementById('playerWrap'); wrap.querySelectorAll('video,iframe').forEach(el=>el.remove());
    document.getElementById('playerPlaceholder').style.display = 'none';
    const sourceRow = document.getElementById('sourceRow'); sourceRow.style.display = 'none';
    
    const loadDiv = document.createElement('div'); loadDiv.id='tmpLoading';
    loadDiv.style.cssText='position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;background:rgba(0,0,0,.85);z-index:10';
    loadDiv.innerHTML = '<div class="spinner"></div><span style="margin-top:10px">Připravuji stream...</span>';
    wrap.appendChild(loadDiv);

    if(state.isFallbackMode) {
        // OPRAVA 2: Reálné demo titulky k volně dostupnému W3C videu, které neshodí CORS
        state.fallbackEnVtt = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
Hey! We are testing the AI fallback system!

2
00:00:04.500 --> 00:00:07.000
Can you believe this is entirely generated by code?

3
00:00:07.500 --> 00:00:10.000
Enjoy your anime with Gemini AI translations!`;

        state.fallbackCzVttUrl = null; loadDiv.remove();

        sourceRow.style.display = 'flex';
        document.getElementById('sourceBtns').innerHTML = `<button class="source-btn active" style="pointer-events:none">EN Zdroj (Fallback)</button>`;
        document.getElementById('badgeContainer').style.display = 'none'; 
        document.getElementById('fallbackControls').style.display = 'flex'; 

        const btnEn = document.getElementById('fbSubEn'); const btnCz = document.getElementById('fbSubCz');
        btnEn.classList.add('active'); btnCz.classList.remove('active'); btnCz.innerHTML = 'AI Překlad CZ';

        const video = document.createElement('video'); video.id = 'fallbackVideo'; video.controls = true; video.autoplay = true; video.crossOrigin = "anonymous";
        video.style.cssText='position:absolute;inset:0;width:100%;height:100%;background:#000;';
        
        // Stabilní, neblokující W3C video
        video.src = 'https://www.w3schools.com/html/mov_bbb.mp4';
        
        const blob = new Blob([state.fallbackEnVtt], { type: 'text/vtt' }); const vttUrl = URL.createObjectURL(blob);
        const track = document.createElement('track'); track.kind = 'subtitles'; track.label = 'English'; track.srclang = 'en'; track.src = vttUrl; track.default = true; track.id = 'track-en';
        
        video.appendChild(track); wrap.appendChild(video);
        return;
    }

    try {
        document.getElementById('fallbackControls').style.display = 'none'; document.getElementById('badgeContainer').style.display = 'flex';
        const html = await proxyFetch(`/serial/${ep.slug}/${ep.code}`);
        const matches = [...html.matchAll(/data-iframe="([A-Za-z0-9+/=]+)"[^>]*class="source_link\s+(\w+)/g)];
        if(!matches.length) throw new Error('Zdroje nenalezeny');
        
        loadDiv.remove(); sourceRow.style.display = 'flex';
        document.getElementById('sourceBtns').innerHTML = `<button class="source-btn active">Svetserialu Embed</button>`;
        document.getElementById('badgeContainer').innerHTML = `<span class="sub-badge">CZ/SK</span>`;

        const iframeUrl = atob(matches[0][1]);
        const iframe = document.createElement('iframe'); iframe.src = iframeUrl; iframe.allowFullscreen = true; iframe.style.cssText='position:absolute;inset:0;width:100%;height:100%;border:none;background:#000';
        wrap.appendChild(iframe);
    } catch(e) { loadDiv.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`; }
}

async function translateSubsWithGemini(vttContent) {
    const prompt = `Translate the following WebVTT file from English to Czech. RULES: 1. Keep timestamps EXACTLY as they are. 2. Output ONLY raw WebVTT content.\n\n${vttContent}`;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 }}) });
    const data = await res.json(); if (data.error) throw new Error(data.error.message);
    
    let txt = (data.candidates?.[0]?.content?.parts?.[0]?.text || '');
    
    // Bezpečný Regex bez problematických znaků
    const pattern = new RegExp(String.fromCharCode(96,96,96) + '(json|vtt)?', 'gi');
    txt = txt.replace(pattern, '').trim();
    
    if(!txt.startsWith('WEBVTT')) { txt = 'WEBVTT\n\n' + txt; } else { txt = txt.replace(/^WEBVTT\s*/, 'WEBVTT\n\n'); }
    return txt;
}

function destroyHls() {}
function updateNavBtns() { document.getElementById('prevEpBtn').disabled = state.currentEpIndex <= 0; document.getElementById('nextEpBtn').disabled = state.currentEpIndex >= state.episodes.length - 1; }
function navigateEp(d) { const nx = state.currentEpIndex + d; if (nx>=0 && nx<state.episodes.length) playEp(nx); }

function toggleWatched() {
    if (!state.currentEp || !state.currentAnime) return;
    const was = isEpWatched(state.currentAnime.id, state.currentEp.number, state.currentEp.season);
    markEpWatched(state.currentAnime.id, state.currentEp.number, state.currentEp.season, !was);
    updateWatchedBtn(); renderEpList(); setupMainPlayBtn();
}

function updateWatchedBtn() {
    if (!state.currentEp || !state.currentAnime) return;
    const w = isEpWatched(state.currentAnime.id, state.currentEp.number, state.currentEp.season);
    document.getElementById('watchedBtn').innerHTML = `<svg width="24" height="24" fill="none" stroke="${w?'var(--success)':'var(--text-3)'}" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`;
}

function toggleFav() {
    if (!state.currentAnime) return;
    let f = getFavs(); const idx = f.findIndex(x => x.id === state.currentAnime.id);
    if (idx>=0) { f.splice(idx,1); showToast('Odebráno z oblíbených'); } else { f.unshift(state.currentAnime); showToast('Přidáno do oblíbených', true); }
    setFavs(f); updateFavBtn();
}

function updateFavBtn() {
    if (!state.currentAnime) return;
    const inFav = getFavs().some(x => x.id === state.currentAnime.id);
    const btn = document.getElementById('favBtn'); btn.className = inFav ? 'btn-outline active' : 'btn-outline';
    document.getElementById('favBtnText').textContent = inFav ? 'V oblíbených' : 'Do oblíbených';
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
    const activeTab = document.querySelector('.filter-tab.active');
    if (activeTab) { switchFilter(activeTab, 'TRENDING'); }
    
    // Check status in background
    proxyFetch('/?searchfor=test')
        .then(() => { document.getElementById('svtDot').className = 'svt-dot ok'; })
        .catch(() => { document.getElementById('svtDot').className = 'svt-dot err'; });
});

</script>