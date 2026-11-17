// Token Radar dashboard (radar-2). Reads window.RADAR from data.js beside dashboard/ and renders the
// ranked board, a top-10 chart, the live comps table, a per-protocol detail drawer with a
// "why this rank" breakdown and the protocol's farm plan. No network: every byte shown is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var RISK_ROWS = 40;

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (n === null || n === undefined || !isFinite(n)) ? 'n/a' : n.toFixed(4); }

  // radar-2, the same arithmetic main.ts runs: TVL x the category's live multiple x growth x maturity.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity));
  }
  function growthPctOf(row, model) {
    return Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasFor(chain) {
    if (chain === 'Ethereum') return { first: '$15', action: '$10', weekly: '$5' };
    if (chain === 'Solana') return { first: '$0.10', action: '$0.10', weekly: '$0.10' };
    if (chain === 'Binance') return { first: '$1', action: '$0.50', weekly: '$0.20' };
    if (['Arbitrum', 'Optimism', 'Base', 'Polygon', 'zkSync Era', 'Blast', 'Linea', 'Scroll', 'Mantle', 'Avalanche', 'Fantom', 'Gnosis'].indexOf(chain) >= 0) {
      return { first: '$2', action: '$1', weekly: '$0.50' };
    }
    return { first: '$3', action: '$2', weekly: '$1' };
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function farmSteps(row) {
    var chain = chainOf(row);
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var gas = gasFor(chain);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under ' + gas.first + ' of gas', time: '5 minutes' },
      { text: actionFor(row, capital, chain), cost: '$' + capital + ' of capital, about ' + gas.action + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about ' + gas.weekly + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ];
    if (row.rank <= RISK_ROWS) {
      steps.push({
        text: 'Implied value is a model, not a promise: this row\'s $' + row.implied_value_usd.toLocaleString('en-US') + ' is what the token could be worth if the protocol\'s record stayed as it is, never a guarantee it issues one.',
        cost: 'nothing but the check', time: '5 minutes', risk: true
      });
    }
    return steps;
  }

  function multipleInfo(category) {
    if (!category) return null;
    var found = null;
    DATA.multiples.forEach(function (m) { if (m.category === category) found = m; });
    return found;
  }
  function totalImplied() {
    return DATA.rows.reduce(function (sum, r) { return sum + r.implied_value_usd; }, 0);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function top10Chart() {
    var top = DATA.rows.slice(0, 10);
    var max = top[0].implied_value_usd || 1;
    var total = totalImplied();
    var topShare = top.reduce(function (s, r) { return s + r.implied_value_usd; }, 0) / total * 100;
    var body = el('div');
    top.forEach(function (r) {
      body.appendChild(el('div', { class: 'chart-row' },
        el('span', { class: 'chart-rank', text: String(r.rank) }),
        el('span', { class: 'chart-label', text: r.name }),
        el('div', { class: 'chart-track' }, el('i', { class: 'chart-fill', style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
        el('span', { class: 'chart-val', text: fmtUsd(r.implied_value_usd) })
      ));
    });
    return el('section', { class: 'panel' },
      el('h2', { text: 'Top 10 by implied value' }),
      el('p', { class: 'sub', text: 'The ten strongest pre-token protocols, scaled to the leader.' }),
      body,
      el('p', { class: 'chart-note', text: 'The top 10 carry ' + topShare.toFixed(1) + '% of the board\'s ' + fmtUsd(total) + ' total implied value.' })
    );
  }

  function compsTable() {
    var list = DATA.multiples.slice().sort(function (a, b) { return b.multiple - a.multiple || a.category.localeCompare(b.category); });
    var tbody = el('tbody');
    list.forEach(function (m) {
      var capped = m.comps > 0 && m.comps < DATA.model.small_n;
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: m.category })),
        el('td', { class: 'num', text: String(m.comps) }),
        el('td', { class: 'num', text: fmtMult(m.median) }),
        el('td', { class: 'num', text: fmtMult(m.multiple) }),
        el('td', null, capped
          ? el('span', { class: 'flag', text: 'capped at ' + DATA.model.small_n_cap + ' — only ' + m.comps + (m.comps === 1 ? ' comp' : ' comps') })
          : el('span', { class: 'sub', text: m.comps === 0 ? 'no live comps — global median' : '—' }))
      ));
    });
    return el('section', { class: 'panel' },
      el('h2', { text: 'How the market prices each category' }),
      el('p', { class: 'sub', text: 'Each category\'s multiple is the median market cap / TVL of the snapshot\'s own live protocols in that category, shrunk toward the global median and clamped to [' + DATA.model.multiple_floor + ', ' + DATA.model.multiple_cap + ']. A category with fewer than ' + DATA.model.small_n + ' live comps cannot set a multiple above ' + DATA.model.small_n_cap + ', so one outlier cannot price a whole category.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Live comps' }),
            el('th', { scope: 'col', text: 'Median mcap / TVL' }),
            el('th', { scope: 'col', text: 'Applied multiple' }),
            el('th', { scope: 'col', text: 'Note' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('p', { class: 'sub', text: 'The category multiple comes from the market itself: the median mcap / TVL of live protocols in that category, shrunk toward the global median (weight ' + m.shrink_weight + ') and clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']. Growth is clamped to [' + m.growth_floor + '%, ' + m.growth_cap + '%] so one hot week cannot set a price. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function whyPanel(row) {
    var m = DATA.model;
    var info = multipleInfo(row.category);
    var growthPct = growthPctOf(row, m);
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var tvlRank = DATA.rows.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; }).findIndex(function (r) { return r.slug === row.slug; }) + 1;
    var multVerdict = row.category_multiple >= 0.3 ? ['up', 'lifts'] : row.category_multiple <= 0.1 ? ['down', 'drags'] : ['flat', 'mid-pack'];
    var growthVerdict = row.growth_multiplier > 1 ? ['up', 'lifts'] : row.growth_multiplier < 1 ? ['down', 'drags'] : ['flat', 'neutral'];
    var matVerdict = row.maturity_multiplier >= 0.9 ? ['up', 'lifts'] : row.maturity_multiplier <= 0.7 ? ['down', 'drags'] : ['flat', 'mid-pack'];
    var driver = multVerdict[0] === 'up' ? 'the market pays up for its category' : growthVerdict[0] === 'up' ? 'a hot seven days' : matVerdict[0] === 'up' ? 'a long no-token record' : 'its sheer TVL';
    var above = row.rank > 1 ? DATA.rows[row.rank - 2] : null;
    var below = row.rank < DATA.rows.length ? DATA.rows[row.rank] : null;
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'Why this rank' }),
      el('div', { class: 'why' },
        el('div', { class: 'factor' },
          el('span', { class: 'fname', text: 'TVL' }),
          el('span', { class: 'fval' }, el('span', { text: fmtUsd(row.tvl_usd) }), el('small', { text: '#' + tvlRank + ' by TVL on the board' })),
          el('span', { class: 'verdict flat', text: 'base' })),
        el('div', { class: 'factor' },
          el('span', { class: 'fname', text: 'Category multiple' }),
          el('span', { class: 'fval' }, el('span', { text: 'x' + fmtMult(row.category_multiple) }),
            el('small', { text: info ? (row.category || 'Other') + ': ' + info.comps + (info.comps === 1 ? ' live comp' : ' live comps') + ', median ' + fmtMult(info.median) + (info.comps > 0 && info.comps < m.small_n ? ' — capped' : '') : 'no live comps — global median fallback' })),
          el('span', { class: 'verdict ' + multVerdict[0], text: multVerdict[1] })),
        el('div', { class: 'factor' },
          el('span', { class: 'fname', text: 'Growth' }),
          el('span', { class: 'fval' }, el('span', { text: 'x' + fmtMult(row.growth_multiplier) }),
            el('small', { text: '7d ' + fmtPct(row.change_7d) + ' clamped to ' + fmtPct(growthPct) })),
          el('span', { class: 'verdict ' + growthVerdict[0], text: growthVerdict[1] })),
        el('div', { class: 'factor' },
          el('span', { class: 'fname', text: 'Maturity' }),
          el('span', { class: 'fval' }, el('span', { text: 'x' + fmtMult(row.maturity_multiplier) }),
            el('small', { text: fmtAge(row.age_days) + ' with no token' + (row.age_days === null || row.age_days === undefined ? ' (age unknown — ' + m.unknown_age_days + 'd assumed)' : '') })),
          el('span', { class: 'verdict ' + matVerdict[0], text: matVerdict[1] }))
      ),
      el('p', { class: 'why-note', text: 'The strongest driver of this rank is ' + driver + '. Rank is the product of all four: a big TVL with a weak multiple still lands low, and a small TVL with a hot category still lands high.' }),
      el('div', { class: 'rivals' },
        above ? el('span', null, 'Above: ', el('b', { text: '#' + above.rank + ' ' + above.name + ' ' + fmtUsd(above.implied_value_usd) })) : el('span', { text: 'Top of the board — nothing above.' }),
        below ? el('span', null, 'Below: ', el('b', { text: '#' + below.rank + ' ' + below.name + ' ' + fmtUsd(below.implied_value_usd) })) : el('span', { text: 'Bottom of the board — nothing below.' })
      )
    );
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(whyPanel(row));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: 'x' + fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: 'x' + fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: 'x' + fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        return el('li', null,
          el('b', { text: s.text }),
          el('div', { class: 'chips' },
            el('span', { class: 'chip', text: 'Cost: ' + s.cost }),
            el('span', { class: 'chip time', text: 'Time: ' + s.time }),
            s.risk ? el('span', { class: 'chip risk', text: 'Model, not a promise' }) : null
          ));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(top10Chart());
      shell.appendChild(moversPanel());
      shell.appendChild(chainPanel());
      shell.appendChild(categoryDivePanel());
      shell.appendChild(riskPanel());
      shell.appendChild(tiersAlertsPanel());
      shell.appendChild(compsTable());
      shell.appendChild(modelPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  // Top Movers: the board's steepest seven-day rises and falls, from window.RADAR.movers.
  // Each row opens the same detail drawer as the board, so a mover's rank can be checked
  // against its model instead of trusted from the momentum alone.
  function moverRow(m, up) {
    var cls = up ? 'pos' : 'neg';
    var arrow = up ? '▲ ' : '▼ ';
    return el('button', { type: 'button', class: 'mover', onclick: function () { openDetail(m.slug); } },
      el('span', { class: 'mover-rank num', text: '#' + m.rank }),
      el('span', { class: 'mover-name' },
        el('b', { text: m.name }),
        el('span', { class: 'sub', text: (m.category || 'Other') + ' · ' + fmtUsd(m.tvl_usd) + ' TVL' })
      ),
      el('span', { class: 'mover-change num ' + cls, text: arrow + fmtPct(m.growth_pct) }),
      el('span', { class: 'mover-value num', text: fmtUsd(m.implied_value_usd) })
    );
  }

  function moversPanel() {
    var movers = DATA.movers || { gainers: [], losers: [], recorded: 0, risers: 0, fallers: 0, flat: 0, unrecorded: 0 };
    var gainers = movers.gainers || [];
    var losers = movers.losers || [];
    var summary = 'Of ' + movers.recorded + ' rows with a recorded week, ' + movers.risers + ' rose, ' + movers.fallers + ' fell and ' + movers.flat + ' were flat' +
      (movers.unrecorded ? '; ' + movers.unrecorded + ' have no seven-day change on record and are left out.' : '.');
    return el('section', { class: 'panel' },
      el('h2', { text: 'Top movers — seven days' }),
      el('p', { class: 'sub', text: 'The board\'s steepest seven-day rises and falls, by the same clamped change_7d the model scores. Momentum is a signal, not a price: a hot week lifts implied value, it does not promise a token. Select a mover to see why it ranks where it does.' }),
      el('p', { class: 'movers-note', text: summary }),
      el('div', { class: 'movers-grid' },
        el('div', { class: 'movers-col' },
          el('h3', { text: 'Rising — top ' + gainers.length }),
          gainers.length ? gainers.map(function (m) { return moverRow(m, true); }) : el('p', { class: 'sub', text: 'No risers with a recorded seven-day change.' })
        ),
        el('div', { class: 'movers-col' },
          el('h3', { text: 'Falling — top ' + losers.length }),
          losers.length ? losers.map(function (m) { return moverRow(m, false); }) : el('p', { class: 'sub', text: 'No fallers with a recorded seven-day change.' })
        )
      )
    );
  }

  // Chain Breakdown: where the board's implied value sits, from window.RADAR.chains.
  // Each protocol counts toward the chain it names first, so the shares add to 100%.
  // The table sorts by implied value, by protocol count, or by average multiple.
  var chainSort = 'implied';
  function chainSortButton(key, label) {
    return el('button', { type: 'button', 'aria-pressed': chainSort === key ? 'true' : 'false', text: label, onclick: function () { chainSort = key; render(); } });
  }

  function chainPanel() {
    var breakdown = DATA.chains || { chains: [], total_implied_value_usd: 0, top3_share_pct: 0 };
    var list = (breakdown.chains || []).slice();
    if (chainSort === 'protocols') list.sort(function (a, b) { return b.protocols - a.protocols || b.total_implied_value_usd - a.total_implied_value_usd; });
    else if (chainSort === 'multiple') list.sort(function (a, b) { return b.avg_multiple - a.avg_multiple || b.total_implied_value_usd - a.total_implied_value_usd; });
    else list.sort(function (a, b) { return b.total_implied_value_usd - a.total_implied_value_usd || (a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0); });
    var max = list.length ? Math.max.apply(null, list.map(function (c) { return c.total_implied_value_usd; })) : 1;
    var total = breakdown.total_implied_value_usd || totalImplied();
    var tbody = el('tbody');
    list.forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: c.chain })),
        el('td', { class: 'num', text: String(c.protocols) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((c.total_implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(c.total_implied_value_usd) })
        )),
        el('td', { class: 'num', text: c.share_pct.toFixed(1) + '%' }),
        el('td', { class: 'num', text: 'x' + c.avg_multiple.toFixed(4) }),
        el('td', null, el('span', { class: 'sub', text: c.top_protocol + ' · ' + fmtUsd(c.top_implied_value_usd) }))
      ));
    });
    return el('section', { class: 'panel' },
      el('h2', { text: 'Chain breakdown' }),
      el('p', { class: 'sub', text: 'Where the board\'s ' + fmtUsd(total) + ' of implied value sits, by each protocol\'s first chain. The average multiple is the mean of the chain\'s protocols\' category multiples, so a chain of high-multiple categories reads higher than a chain of low-multiple ones.' }),
      el('div', { class: 'sort-row' },
        el('span', { class: 'sub', text: 'Sort by' }),
        chainSortButton('implied', 'Implied value'),
        chainSortButton('protocols', 'Protocols'),
        chainSortButton('multiple', 'Avg multiple')
      ),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Chain' }),
            el('th', { scope: 'col', text: 'Protocols' }),
            el('th', { scope: 'col', text: 'Implied value' }),
            el('th', { scope: 'col', text: 'Share' }),
            el('th', { scope: 'col', text: 'Avg multiple' }),
            el('th', { scope: 'col', text: 'Largest protocol' })
          )),
          tbody
        )
      ),
      el('p', { class: 'chain-note', text: 'The top 3 chains hold ' + breakdown.top3_share_pct.toFixed(1) + '% of the board\'s implied value across ' + list.length + ' chains.' })
    );
  }

  // Category Deep Dive: every category on the board, strongest first, from window.RADAR.categories.
  // Each row shows the category's share of the board, its mean multiple and its momentum; the
  // leading category's five strongest protocols open the same detail drawer as the board.
  function categoryDivePanel() {
    var dive = DATA.categories || { categories: [], total_implied_value_usd: 0, top3_share_pct: 0, hottest_category: null, hottest_momentum_pct: null, coldest_category: null, coldest_momentum_pct: null };
    var list = dive.categories || [];
    var max = list.length ? Math.max.apply(null, list.map(function (c) { return c.total_implied_value_usd; })) : 1;
    var total = dive.total_implied_value_usd || totalImplied();
    var tbody = el('tbody');
    list.forEach(function (c) {
      var hasMomentum = c.momentum_pct !== null && c.momentum_pct !== undefined;
      var momentum = hasMomentum ? fmtPct(c.momentum_pct) : 'n/a';
      var momentumClass = !hasMomentum ? '' : c.momentum_pct >= 0 ? 'pos' : 'neg';
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: c.category })),
        el('td', { class: 'num', text: String(c.protocols) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((c.total_implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(c.total_implied_value_usd) })
        )),
        el('td', { class: 'num', text: c.share_pct.toFixed(1) + '%' }),
        el('td', { class: 'num', text: 'x' + c.avg_multiple.toFixed(4) }),
        el('td', { class: 'num ' + momentumClass, text: momentum }),
        el('td', null, el('span', { class: 'sub', text: c.top_protocol + ' · ' + fmtUsd(c.top_implied_value_usd) }))
      ));
    });
    var leader = list[0] || null;
    var hotNote = dive.hottest_category
      ? 'Hottest: ' + dive.hottest_category + ' at ' + fmtPct(dive.hottest_momentum_pct) + '; coldest: ' + dive.coldest_category + ' at ' + fmtPct(dive.coldest_momentum_pct) + '. '
      : '';
    return el('section', { class: 'panel' },
      el('h2', { text: 'Category deep dive' }),
      el('p', { class: 'sub', text: 'Where the board\'s ' + fmtUsd(total) + ' of implied value sits, by category. The average multiple is the mean of the category\'s protocols\' category multiples; the top 3 categories hold ' + dive.top3_share_pct.toFixed(1) + '% of the board. ' + hotNote + 'Momentum is the mean of the clamped seven-day change across the category\'s protocols; a category with no recorded week has no momentum, not a flat one.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Protocols' }),
            el('th', { scope: 'col', text: 'Implied value' }),
            el('th', { scope: 'col', text: 'Share' }),
            el('th', { scope: 'col', text: 'Avg multiple' }),
            el('th', { scope: 'col', text: 'Momentum 7d' }),
            el('th', { scope: 'col', text: 'Largest protocol' })
          )),
          tbody
        )
      ),
      leader ? el('div', { class: 'dive-leader' },
        el('h3', { text: 'Top 5 in ' + leader.category + ' — the board\'s largest category' }),
        leader.top.map(function (p) {
          return el('button', { type: 'button', class: 'mover', onclick: function () { openDetail(p.slug); } },
            el('span', { class: 'mover-rank num', text: '#' + p.rank }),
            el('span', { class: 'mover-name' },
              el('b', { text: p.name }),
              el('span', { class: 'sub', text: fmtUsd(p.tvl_usd) + ' TVL' })
            ),
            el('span', { class: 'mover-change num ' + (p.change_7d === null ? '' : p.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(p.change_7d) }),
            el('span', { class: 'mover-value num', text: fmtUsd(p.implied_value_usd) })
          );
        })
      ) : null
    );
  }

  // Risk & Concentration: how much of the board rides on a few names, from window.RADAR.risk.
  // The HHI sums the squared percentage shares of every protocol, so a board carried by one
  // name reads high and a board split evenly reads near zero. The label is a read, not a rank.
  function riskPanel() {
    var risk = DATA.risk || { hhi: 0, hhi_band: 'low', top1_share_pct: 0, top5_share_pct: 0, top10_share_pct: 0, top_protocol: '', top_implied_value_usd: 0, top_category: '', top_category_share_pct: 0, thresholds: [], above_one_pct: 0, risk_score: 0, risk_label: 'diversified' };
    var bandText = risk.hhi_band === 'high' ? 'high — one or a few names carry the board' : risk.hhi_band === 'moderate' ? 'moderate — value is spread, with a heavy top' : 'low — value is spread across many names';
    var scoreText = risk.risk_label === 'concentrated' ? 'concentrated' : risk.risk_label === 'watch' ? 'watch' : 'diversified';
    var tbody = el('tbody');
    (risk.thresholds || []).forEach(function (t) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'at least ' + fmtUsd(t.threshold_usd) }),
        el('td', { class: 'num', text: String(t.protocols) }),
        el('td', { class: 'num', text: t.share_pct.toFixed(1) + '%' })
      ));
    });
    return el('section', { class: 'panel' },
      el('h2', { text: 'Risk & concentration' }),
      el('p', { class: 'sub', text: 'The board\'s ' + fmtUsd(totalImplied()) + ' of implied value is not spread evenly: ' + risk.top_protocol + ' alone carries ' + risk.top1_share_pct.toFixed(1) + '% of it, and the top 10 carry ' + risk.top10_share_pct.toFixed(1) + '%. The largest category, ' + risk.top_category + ', holds ' + risk.top_category_share_pct.toFixed(1) + '%. Concentration is a property of the board, not a flaw in a protocol — but a launch that depends on one name is a different bet from one spread across many.' }),
      el('div', { class: 'facts risk-facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Concentration (HHI)' }), el('b', { text: String(risk.hhi) }), el('span', { class: 'sub', text: bandText })),
        el('div', { class: 'fact' }, el('span', { text: 'Top 10 share' }), el('b', { text: risk.top10_share_pct.toFixed(1) + '%' }), el('span', { class: 'sub', text: 'Top 5 hold ' + risk.top5_share_pct.toFixed(1) + '%' })),
        el('div', { class: 'fact' }, el('span', { text: 'Largest category' }), el('b', { text: risk.top_category }), el('span', { class: 'sub', text: risk.top_category_share_pct.toFixed(1) + '% of the board' })),
        el('div', { class: 'fact' }, el('span', { text: 'Risk score' }), el('b', { text: String(risk.risk_score) + ' / 100' }), el('span', { class: 'sub', text: scoreText + ' · ' + risk.above_one_pct + ' protocols above 1% each' }))
      ),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Implied value at least' }),
            el('th', { scope: 'col', text: 'Protocols' }),
            el('th', { scope: 'col', text: 'Share of board' })
          )),
          tbody
        )
      ),
      el('p', { class: 'risk-note', text: 'Risk score blends the HHI with the top-10 share and the largest category\'s share: below 30 reads diversified, below 55 reads watch, 55 and up reads concentrated. ' + risk.above_one_pct + ' protocols each carry at least 1% of the board\'s implied value.' })
    );
  }

  // TVL Tiers & Watchlist Alerts, from window.RADAR.tiers and window.RADAR.alerts: where the
  // board's implied value sits by protocol size, and which protocols trip a watch condition.
  function tiersAlertsPanel() {
    var tiers = DATA.tiers || { tiers: [], largest_tier: '', largest_tier_share_pct: 0 };
    var alerts = DATA.alerts || { alerts: [], hot: 0, concentrated: 0, large_unranked: 0 };
    var facts = tiers.tiers.map(function (tier) {
      return el('div', { class: 'fact' },
        el('span', { text: tier.label + ' TVL' }),
        el('b', { text: fmtUsd(tier.total_implied_value_usd) }),
        el('span', { class: 'sub', text: tier.protocols + ' protocols · ' + tier.share_pct.toFixed(1) + '% of board' }),
        el('span', { class: 'sub', text: 'avg multiple x' + tier.avg_multiple.toFixed(3) + ' · top ' + tier.top_protocol }));
    });
    var tbody = el('tbody');
    alerts.alerts.forEach(function (a) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'alert-tag ' + a.kind, text: a.kind_label })),
        el('td', null, el('b', { text: a.name }), el('span', { class: 'sub', text: ' #' + a.rank + ' · ' + fmtUsd(a.implied_value_usd) + ' implied' })),
        el('td', { text: a.reason })));
    });
    return el('section', { class: 'panel' },
      el('h2', { text: 'TVL tiers & watchlist alerts' }),
      el('p', { class: 'sub', text: 'Four TVL tiers; the ' + tiers.largest_tier + ' tier holds the most implied value (' + tiers.largest_tier_share_pct.toFixed(1) + '%). Below it, ' + alerts.alerts.length + ' protocols trip a watch condition (' + alerts.hot + ' hot, ' + alerts.concentrated + ' concentrated-category, ' + alerts.large_unranked + ' large outside the top 20) — flags to check, not ranks.' }),
      el('div', { class: 'facts' }, facts),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Watch condition' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'Why it is flagged' }))),
          tbody)),
      el('p', { class: 'tiers-note', text: 'Hot: clamped seven-day change at least +50% with at least $10M implied. Concentrated: its category holds at least 40% of the board. Large unranked: at least $50M implied outside the top 20.' }));
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
