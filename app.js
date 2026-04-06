// ===========================
// VIXA LEAD FINDER — app.js
// ===========================

const API_BASE = 'http://localhost:3000';

let allResults = [];
let currentFilter = 'all';
let isSearching = false;

// ---- DOM References ----
const searchBtn      = document.getElementById('search-btn');
const searchBtnText  = document.getElementById('search-btn-text');
const locationInput  = document.getElementById('location-input');
const businessTypeSelect = document.getElementById('business-type');
const maxResultsSelect   = document.getElementById('max-results');
const progressContainer  = document.getElementById('progress-container');
const progressBar        = document.getElementById('progress-bar');
const progressText       = document.getElementById('progress-text');
const progressPercent    = document.getElementById('progress-percent');
const progressStats      = document.getElementById('progress-stats');
const statsBar           = document.getElementById('stats-bar');
const filterTabs         = document.getElementById('filter-tabs');
const resultsGrid        = document.getElementById('results-grid');
const emptyState         = document.getElementById('empty-state');
const placeholderState   = document.getElementById('placeholder-state');
const statTotal          = document.getElementById('stat-total');
const statNoWeb          = document.getElementById('stat-no-web');
const statLow            = document.getElementById('stat-low');
const statGood           = document.getElementById('stat-good');
const cardTemplate       = document.getElementById('card-template');

// ============================================================
// EVENT DELEGATION — handles all card button clicks globally
// ============================================================
document.addEventListener('click', function (e) {
  // ── Let native <a href> links navigate without any JS interference ──────
  // This covers the Google Maps button, View Website button, and WhatsApp link
  if (e.target.closest('a[href]')) return;

  // Export CSV button
  if (e.target.closest('#export-btn')) { exportCSV(); return; }

  // Copy Info button
  const copyBtn = e.target.closest('.copy-btn');
  if (copyBtn) { copyInfo(copyBtn); return; }

  // Copy individual email button
  const emailCopyBtn = e.target.closest('.email-copy-btn');
  if (emailCopyBtn) {
    const email = emailCopyBtn.dataset.email;
    if (email) copyEmail(emailCopyBtn, email);
    return;
  }

  // Re-fetch email button
  const refetchBtn = e.target.closest('.refetch-email-btn');
  if (refetchBtn) { refetchEmail(refetchBtn); return; }

  // Filter tabs
  const tabBtn = e.target.closest('.tab-btn');
  if (tabBtn) {
    const f = tabBtn.dataset.filter;
    if (f) setFilter(f);
    return;
  }
});

// ============================================================
// SEARCH
// ============================================================
searchBtn.addEventListener('click', startSearch);
locationInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startSearch(); });

async function startSearch() {
  if (isSearching) return;

  const location    = locationInput.value.trim();
  const businessType = businessTypeSelect.value;
  const maxResults  = maxResultsSelect.value;

  if (!location) {
    locationInput.style.borderColor = 'var(--red)';
    locationInput.style.boxShadow   = '0 0 0 3px rgba(239,68,68,0.15)';
    setTimeout(() => { locationInput.style.borderColor = ''; locationInput.style.boxShadow = ''; }, 2000);
    locationInput.focus();
    return;
  }

  isSearching = true;
  allResults  = [];
  currentFilter = 'all';

  placeholderState.style.display = 'none';
  emptyState.style.display       = 'none';
  resultsGrid.innerHTML          = '';
  statsBar.style.display         = 'none';
  filterTabs.style.display       = 'none';
  progressContainer.style.display = 'block';

  searchBtn.disabled    = true;
  searchBtnText.textContent = 'Searching...';

  setProgress(0, 'Connecting to Google Places...');
  updateStats();

  // Reset tab active state
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-all').classList.add('active');

  const url = `${API_BASE}/api/search?location=${encodeURIComponent(location)}&businessType=${encodeURIComponent(businessType)}&maxResults=${maxResults}`;
  const evtSource = new EventSource(url);

  evtSource.onmessage = (e) => {
    const data = JSON.parse(e.data);

    if (data.type === 'status') {
      setProgress(data.progress || 0, data.message);
      if (data.total) progressStats.textContent = `Processing ${data.total} businesses...`;
    }

    if (data.type === 'result') {
      addResult(data.place);
    }

    if (data.type === 'complete') {
      setProgress(100, `Done! Found ${data.total} businesses.`);
      const noWebCount  = allResults.filter(r => !r.hasWebsite).length;
      const lowCount    = allResults.filter(r => r.leadPriority === 'medium').length;
      progressStats.textContent = `${noWebCount} with no website · ${lowCount} low quality`;

      setTimeout(() => {
        progressContainer.style.display = 'none';
        finishSearch();
      }, 1200);

      evtSource.close();
      resetBtn();
    }

    if (data.type === 'error') {
      progressText.textContent = '⚠️ Error: ' + data.message;
      progressText.style.color = 'var(--red)';
      evtSource.close();
      resetBtn();
    }
  };

  evtSource.onerror = () => {
    progressText.textContent = '⚠️ Cannot connect. Is the server running?';
    progressText.style.color = 'var(--red)';
    evtSource.close();
    resetBtn();
  };
}

function resetBtn() {
  isSearching = false;
  searchBtn.disabled = false;
  searchBtnText.textContent = 'Search for Leads';
}

function finishSearch() {
  if (allResults.length === 0) {
    emptyState.style.display = 'block';
    emptyState.querySelector('.empty-title').textContent = 'No results found';
    emptyState.querySelector('.empty-sub').textContent   = 'Try a different location or business type';
    return;
  }
  statsBar.style.display   = 'flex';
  filterTabs.style.display = 'flex';
  applyFilter(currentFilter);
}

function setProgress(pct, msg) {
  progressBar.style.width   = pct + '%';
  progressPercent.textContent = pct + '%';
  progressText.textContent  = msg;
  progressText.style.color  = '';
}

// ============================================================
// CARD CREATION
// ============================================================
function addResult(place) {
  allResults.push(place);
  updateStats();
  resultsGrid.appendChild(createCard(place));
}

function createCard(place) {
  const clone = cardTemplate.content.cloneNode(true);
  const card  = clone.querySelector('.lead-card');

  // Priority border
  card.classList.add(`priority-${place.leadPriority}`);
  card.dataset.priority = place.leadPriority;
  card.dataset.filter   = !place.hasWebsite ? 'no-web'
                          : place.leadPriority === 'medium' ? 'low'
                          : 'good';

  // Enrichment metadata for re-fetch
  card.dataset.website = place.website || '';
  card.dataset.phone   = place.phone   || '';

  // ── Badge ──────────────────────────────────────────────────
  const badge = card.querySelector('.card-badge');
  if (!place.hasWebsite) {
    badge.textContent = '🔴 NO WEBSITE';
    badge.className   = 'card-badge badge-no-web';
  } else if (place.leadPriority === 'medium') {
    badge.textContent = '🟡 LOW QUALITY';
    badge.className   = 'card-badge badge-low';
  } else {
    badge.textContent = '🟢 HAS WEBSITE';
    badge.className   = 'card-badge badge-good';
  }

  // ── Rating ────────────────────────────────────────────────
  if (place.rating) {
    card.querySelector('.rating-val').textContent   = place.rating.toFixed(1);
    card.querySelector('.rating-count').textContent = `(${place.ratingCount.toLocaleString()})`;
  } else {
    card.querySelector('.card-rating').style.display = 'none';
  }

  // ── Name / category ───────────────────────────────────────
  card.querySelector('.card-name').textContent     = place.name;
  card.querySelector('.card-category').textContent = place.category || '';

  // ── Phone ─────────────────────────────────────────────────
  if (place.phone) {
    const phoneRow = card.querySelector('.phone-row');
    phoneRow.style.display = 'flex';
    phoneRow.querySelector('.phone-val').textContent = place.phone;
  }

  // ── Address ───────────────────────────────────────────────
  card.querySelector('.address-val').textContent = place.address;

  // ── Website quality ───────────────────────────────────────
  const wsLabel  = card.querySelector('.ws-label');
  const wsScore  = card.querySelector('.ws-score');
  const wsIssues = card.querySelector('.ws-issues');

  if (!place.hasWebsite) {
    wsLabel.textContent = 'No website found';
    wsLabel.style.color = 'var(--red)';
    wsIssues.innerHTML  = '<span class="issue-tag" style="background:var(--red-bg);color:var(--red);border-color:var(--red-border)">Prime Lead — No Online Presence</span>';
  } else {
    const scoreColor = place.websiteScore >= 70 ? 'var(--green)'
                      : place.websiteScore >= 40 ? 'var(--yellow)'
                      : 'var(--red)';
    wsLabel.textContent  = 'Website Quality Score';
    wsLabel.style.color  = 'var(--text-dim)';
    wsScore.textContent  = `${place.websiteScore}/100`;
    wsScore.style.color  = scoreColor;
    wsIssues.innerHTML   = (place.websiteIssues || []).map(i => `<span class="issue-tag">${i}</span>`).join('');
  }

  // ── Contact block (email + WhatsApp) ──────────────────────
  renderContactBlock(card, place.emails || [], place.whatsappLink || null, place.phone);

  // ── Google Maps button ────────────────────────────────────
  const mapsBtn = card.querySelector('.maps-btn');
  const mapsUrl = place.googleMapsUrl
    || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + place.address)}`;
  mapsBtn.setAttribute('href', mapsUrl);

  // ── View Website button ───────────────────────────────────
  const siteBtn = card.querySelector('.site-btn');
  if (place.website) {
    siteBtn.style.display = 'flex';
    siteBtn.setAttribute('href', place.website);
  } else {
    siteBtn.style.display = 'none';
  }

  // ── Store copy payload ────────────────────────────────────
  card.dataset.copyData = JSON.stringify({
    name:     place.name,
    phone:    place.phone     || 'N/A',
    emails:   (place.emails   || []).join(', ') || 'Not found',
    whatsapp: place.whatsappLink || 'N/A',
    address:  place.address,
    website:  place.website   || 'No Website',
    rating:   place.rating    || 'N/A',
    quality:  place.hasWebsite ? `Score: ${place.websiteScore}/100` : 'No Website',
    mapsUrl,
  });

  return card;
}

// ============================================================
// CONTACT BLOCK
// ============================================================
function renderContactBlock(card, emails, whatsappLink, phone) {
  const emailsDiv      = card.querySelector('.contact-emails');
  const whatsappDiv    = card.querySelector('.contact-whatsapp');
  const whatsappAnchor = whatsappDiv.querySelector('.whatsapp-btn');
  const whatsappNum    = whatsappDiv.querySelector('.whatsapp-number');

  // Emails
  if (emails && emails.length > 0) {
    emailsDiv.innerHTML = emails.map(e => `
      <div class="email-pill">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;opacity:0.6">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
          <polyline points="22,6 12,13 2,6"/>
        </svg>
        <span class="email-text">${e}</span>
        <button class="email-copy-btn" data-email="${e}" title="Copy email">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
      </div>`).join('');
  } else {
    emailsDiv.innerHTML = `
      <div class="email-not-found">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.5;flex-shrink:0">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>Email not found — try WhatsApp below</span>
      </div>`;
  }

  // WhatsApp
  if (whatsappLink) {
    whatsappDiv.style.display = 'block';
    whatsappAnchor.setAttribute('href', whatsappLink);
    whatsappNum.textContent = phone ? '· ' + phone : '';
  } else {
    whatsappDiv.style.display = 'none';
  }
}

// ============================================================
// STATS & FILTER
// ============================================================
function updateStats() {
  const total  = allResults.length;
  const noWeb  = allResults.filter(r => !r.hasWebsite).length;
  const low    = allResults.filter(r => r.hasWebsite && r.leadPriority === 'medium').length;
  const good   = allResults.filter(r => r.hasWebsite && r.leadPriority === 'low').length;

  statTotal.textContent = total;
  statNoWeb.textContent = noWeb;
  statLow.textContent   = low;
  statGood.textContent  = good;
}

function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));

  const tabMap = { all: 'tab-all', 'no-web': 'tab-no-web', low: 'tab-low', good: 'tab-good' };
  const activeTab = document.getElementById(tabMap[filter]);
  if (activeTab) activeTab.classList.add('active');

  applyFilter(filter);
}

function applyFilter(filter) {
  const cards = resultsGrid.querySelectorAll('.lead-card');
  let visible = 0;

  cards.forEach(card => {
    const cf = card.dataset.filter;
    const show = filter === 'all'
      || (filter === 'no-web' && cf === 'no-web')
      || (filter === 'low'    && cf === 'low')
      || (filter === 'good'   && cf === 'good');

    card.classList.toggle('hidden', !show);
    if (show) visible++;
  });

  emptyState.style.display = (visible === 0 && allResults.length > 0) ? 'block' : 'none';
}

// ============================================================
// COPY FUNCTIONS
// ============================================================
function copyInfo(btn) {
  const card = btn.closest('.lead-card');
  if (!card) return;

  let data = {};
  try { data = JSON.parse(card.dataset.copyData || '{}'); } catch { return; }

  const text = [
    `Business:  ${data.name    || ''}`,
    `Phone:     ${data.phone   || 'N/A'}`,
    `Email(s):  ${data.emails  || 'Not found'}`,
    `WhatsApp:  ${data.whatsapp|| 'N/A'}`,
    `Address:   ${data.address || ''}`,
    `Website:   ${data.website || 'No Website'}`,
    `Rating:    ${data.rating  || 'N/A'}`,
    `Quality:   ${data.quality || ''}`,
    `Maps:      ${data.mapsUrl || ''}`,
  ].join('\n');

  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
    btn.style.color       = 'var(--green)';
    btn.style.borderColor = 'rgba(16,185,129,0.4)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; btn.style.borderColor = ''; }, 2000);
  }).catch(() => {
    // Clipboard fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
    btn.style.color = 'var(--green)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 2000);
  });
}

function copyEmail(btn, email) {
  navigator.clipboard.writeText(email).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    btn.style.color = 'var(--green)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 1800);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = email;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    btn.style.color = 'var(--green)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 1800);
  });
}

// ============================================================
// RE-FETCH EMAIL (on-demand for a single card)
// ============================================================
async function refetchEmail(btn) {
  const card    = btn.closest('.lead-card');
  if (!card || btn.classList.contains('spinning')) return;

  const website = card.dataset.website || '';
  const phone   = card.dataset.phone   || '';

  btn.classList.add('spinning');
  const emailsDiv = card.querySelector('.contact-emails');
  emailsDiv.innerHTML = `<div class="contact-searching"><span class="searching-dot"></span> Searching for email...</div>`;

  try {
    const params = new URLSearchParams();
    if (website) params.set('website', website);
    if (phone)   params.set('phone', phone);
    const res  = await fetch(`${API_BASE}/api/enrich?${params}`);
    const data = await res.json();

    renderContactBlock(card, data.emails || [], data.whatsappLink || null, phone);

    // Update stored copy payload
    try {
      const copy = JSON.parse(card.dataset.copyData || '{}');
      copy.emails   = (data.emails || []).join(', ') || 'Not found';
      copy.whatsapp = data.whatsappLink || 'N/A';
      card.dataset.copyData = JSON.stringify(copy);
    } catch { /* ignore */ }
  } catch {
    emailsDiv.innerHTML = `<div class="email-not-found"><span>Re-search failed — check connection</span></div>`;
  } finally {
    btn.classList.remove('spinning');
  }
}

// ============================================================
// CSV EXPORT
// ============================================================
function exportCSV() {
  if (allResults.length === 0) return;

  const headers = [
    'Name','Category','Phone',
    'Email 1','Email 2','Email 3',
    'WhatsApp Link','Address',
    'Rating','Reviews',
    'Has Website','Website URL','Website Score','Website Issues',
    'Lead Priority','Google Maps URL'
  ];

  const rows = allResults.map(p => [
    `"${(p.name    || '').replace(/"/g,'""')}"`,
    `"${(p.category|| '')}"`,
    `"${(p.phone   || '')}"`,
    `"${(p.emails  || [])[0] || ''}"`,
    `"${(p.emails  || [])[1] || ''}"`,
    `"${(p.emails  || [])[2] || ''}"`,
    `"${p.whatsappLink || ''}"`,
    `"${(p.address || '').replace(/"/g,'""')}"`,
    p.rating     || '',
    p.ratingCount|| 0,
    p.hasWebsite ? 'Yes' : 'No',
    `"${p.website || ''}"`,
    p.hasWebsite ? p.websiteScore : '',
    `"${(p.websiteIssues || []).join('; ')}"`,
    p.leadPriority,
    `"${p.googleMapsUrl || ''}"`,
  ]);

  const csv  = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const loc  = (locationInput.value.trim() || 'results').replace(/[^a-z0-9]/gi, '_');
  const biz  = (businessTypeSelect.value   || 'leads').replace(/[^a-z0-9]/gi, '_');
  a.href     = url;
  a.download = `vixa_leads_${biz}_${loc}_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
