/* Aerialist client portal | STAGE 1: sign in + read-only dashboard.
   TEST BUILD. Written without access to a live database, so it has not been run against one.
   Reads only. No writes, no downloads, no payments yet (Stages 2 and 3). */
(function () {
  'use strict';

  var cfg = window.PORTAL_CONFIG || {};
  var state = { sb: null, user: null, tenants: [], tenantId: null, jobs: [], invoices: [], seq: 0 };

  var STEPS = ['Bid', 'Field', 'Processing', 'Delivery', 'Payment'];
  // Which pipeline step is "current" for each job status. 5 means every step is done.
  var STEP_INDEX = { bid_pending: 0, bid_accepted: 1, scheduled: 1, in_field: 1, processing: 2, in_delivery: 3, paid: 5, cancelled: -1 };
  var STATUS_LABEL = {
    bid_pending: 'Bid pending', bid_accepted: 'Bid accepted', scheduled: 'Scheduled', in_field: 'In the field',
    processing: 'Processing', in_delivery: 'In delivery', paid: 'Paid', cancelled: 'Cancelled'
  };

  var JOB_COLS = 'id, job_code, title, status, aircraft, image_count, gsd_cm, crs, processing_software, qc_passed, next_flight, created_at';
  // r2_key is deliberately not listed: clients have no permission to read that column.
  var DEL_COLS = 'id, job_id, name, kind, file_format, size_bytes, locked, released_at, created_at';
  var INV_COLS = 'id, job_id, invoice_code, amount_cents, currency, status, due_date, paid_at, created_at';
  var STAT_COLS = 'active_jobs, deliverables_ready, awaiting_payment_cents, next_flight';

  function $(id) { return document.getElementById(id); }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(cents, cur) {
    var amt = (Number(cents) || 0) / 100;
    try {
      return amt.toLocaleString('en-US', { style: 'currency', currency: String(cur || 'usd').toUpperCase() });
    } catch (e) {
      return '$' + amt.toFixed(2);
    }
  }

  function fmtSize(n) {
    if (n == null) return '';
    n = Number(n);
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB';
    if (n >= 1e6) return Math.round(n / 1e6) + ' MB';
    if (n >= 1e3) return Math.round(n / 1e3) + ' KB';
    return n + ' B';
  }

  function dateOnly(s) {
    if (!s) return 'None scheduled';
    var p = String(s).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (isNaN(d.getTime())) return String(s);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function dateTime(s) {
    var d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function show(id, on) { $(id).hidden = !on; }
  function setMsg(t) { $('loginMsg').textContent = t || ''; }
  function notice(t) { var n = $('notice'); n.textContent = t || ''; n.hidden = !t; }

  function explain(err) {
    var m = (err && err.message) ? err.message : 'Unknown error';
    if (err && (err.code === '42501' || /permission denied/i.test(m))) {
      return 'Permission denied by the database. Check that the phase 1 file ran and that the tables are exposed in the Supabase Data API settings.';
    }
    return 'Could not load data: ' + m;
  }

  function configured() {
    return cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY &&
      cfg.SUPABASE_URL.indexOf('PASTE_') !== 0 && cfg.SUPABASE_PUBLISHABLE_KEY.indexOf('PASTE_') !== 0;
  }

  function clearData() {
    ['stats', 'pipe', 'jobmeta', 'deliverables', 'invoice', 'history'].forEach(function (id) { $(id).innerHTML = ''; });
    $('tenantName').textContent = '';
    $('tenantMeta').textContent = '';
    $('jobTitle').textContent = '';
    $('testInfo').textContent = '';
    notice('');
    state.tenants = []; state.tenantId = null; state.jobs = []; state.invoices = [];
  }

  function showLogin() {
    clearData();
    show('appView', false);
    show('loginView', true);
    $('banner').textContent = 'Test build \u00b7 Stage 1 \u00b7 read-only \u00b7 sign in with a test account';
  }

  /* ---------- rendering ---------- */

  function renderStats(s) {
    s = s || {};
    var cards = [
      ['Active jobs', s.active_jobs == null ? '0' : String(s.active_jobs)],
      ['Deliverables ready', s.deliverables_ready == null ? '0' : String(s.deliverables_ready)],
      ['Awaiting payment', money(s.awaiting_payment_cents || 0, 'usd')],
      ['Next flight', dateOnly(s.next_flight)]
    ];
    $('stats').innerHTML = cards.map(function (c) {
      return '<div class="stat"><div class="stat__label">' + esc(c[0]) + '</div><div class="stat__value">' + esc(c[1]) + '</div></div>';
    }).join('');
  }

  function renderJobPicker() {
    $('jobSel').innerHTML = state.jobs.map(function (j) {
      return '<option value="' + esc(j.id) + '">' + esc(j.job_code + ' \u2014 ' + j.title) + '</option>';
    }).join('');
    show('jobPick', state.jobs.length > 1);
  }

  function renderPipeline(job) {
    var c = STEP_INDEX[job.status];
    if (c === undefined) c = -1;
    $('pipe').innerHTML = STEPS.map(function (name, i) {
      var cls = c === -1 ? '' : (i < c ? 'done' : (i === c ? 'current' : ''));
      var dot = cls === 'done' ? '\u2713' : (cls === 'current' ? '\u25cf' : '');
      return '<div class="pipe__step ' + cls + '"><div class="pipe__dot">' + dot + '</div><div class="pipe__label">' + esc(name) + '</div></div>';
    }).join('');
  }

  function renderJobMeta(job) {
    var meta = [];
    if (job.aircraft) meta.push('<b>Aircraft:</b> ' + esc(job.aircraft));
    if (job.image_count != null) meta.push('<b>Images:</b> ' + esc(job.image_count));
    if (job.gsd_cm != null) meta.push('<b>GSD:</b> ' + esc(job.gsd_cm) + ' cm');
    if (job.crs) meta.push('<b>CRS:</b> ' + esc(job.crs));
    if (job.processing_software) meta.push('<b>Processing:</b> ' + esc(job.processing_software));
    if (job.qc_passed != null) meta.push('<b>QC:</b> ' + (job.qc_passed ? '<span class="ok">Passed</span>' : '<span class="warn">Not passed</span>'));
    $('jobmeta').innerHTML = meta.join(' &nbsp;\u00b7&nbsp; ');
  }

  function renderDeliverables(list) {
    if (!list.length) {
      $('deliverables').innerHTML = '<p class="muted">No deliverables for this job yet.</p>';
      return;
    }
    $('deliverables').innerHTML = list.map(function (d) {
      var locked = !!d.locked;
      var detail = [d.file_format, fmtSize(d.size_bytes)].filter(Boolean).join(' \u00b7 ');
      var label = locked ? 'Pay to unlock' : (d.kind === 'coi' ? 'Review' : 'Download');
      return '<div class="drow">' +
        '<div class="dname"><span class="n">' + esc(d.name) + '</span><span class="m">' + esc(detail) + '</span></div>' +
        '<span class="badge ' + (locked ? 'badge--locked' : 'badge--ready') + '">' + (locked ? 'Locked' : 'Ready') + '</span>' +
        '<button class="btn' + (locked ? ' btn--ghost' : '') + '" type="button" disabled>' + esc(label) + '</button>' +
        '</div>';
    }).join('');
  }

  function renderInvoice(job) {
    var inv = state.invoices.filter(function (i) { return i.job_id === job.id; })[0];
    if (!inv) {
      $('invoice').innerHTML = '<p class="muted">No invoice for this job yet.</p>';
      return;
    }
    var head = (inv.status === 'paid' ? 'Paid' : 'Balance due') + ' \u00b7 ' + inv.invoice_code;
    $('invoice').innerHTML = '<div class="invoice"><div class="invoice__amt"><small>' + esc(head) + '</small>' +
      esc(money(inv.amount_cents, inv.currency)) + '</div><div class="actions">' +
      '<button class="btn btn--ghost" type="button" disabled>View invoice</button>' +
      (inv.status === 'open' ? '<button class="btn btn--solid" type="button" disabled>Pay now</button>' : '') +
      '</div></div><p class="note">Buttons switch on in later stages: downloads in Stage 2, payments in Stage 3.</p>';
  }

  function renderHistory(events) {
    if (!events.length) {
      $('history').innerHTML = '<p class="muted">No history yet.</p>';
      return;
    }
    $('history').innerHTML = events.map(function (e) {
      return '<div class="hrow"><span class="hstatus">' + esc(STATUS_LABEL[e.status] || e.status) + '</span>' +
        '<span class="hnote">' + esc(e.note || '') + '</span><span class="hdate">' + esc(dateTime(e.created_at)) + '</span></div>';
    }).join('');
  }

  /* ---------- data loading ---------- */

  async function loadJob(jobId, seq) {
    var job = state.jobs.filter(function (j) { return j.id === jobId; })[0];
    if (!job) return;
    $('jobTitle').textContent = job.job_code + ' \u2014 ' + job.title + ' \u00b7 ' + (STATUS_LABEL[job.status] || job.status);
    renderPipeline(job);
    renderJobMeta(job);
    renderInvoice(job);

    var res = await Promise.all([
      state.sb.from('deliverables').select(DEL_COLS).eq('job_id', jobId).order('created_at', { ascending: true }),
      state.sb.from('job_events').select('status, note, created_at').eq('job_id', jobId).order('created_at', { ascending: true })
    ]);
    if (seq !== state.seq) return;          // a newer selection replaced this one
    if (res[0].error) { notice(explain(res[0].error)); return; }
    if (res[1].error) { notice(explain(res[1].error)); return; }
    renderDeliverables(res[0].data || []);
    renderHistory(res[1].data || []);
    $('testInfo').textContent = 'Test build. Signed in as ' + state.user.email + ' (id ' + state.user.id + '). Rows visible: ' +
      state.tenants.length + ' companies, ' + state.jobs.length + ' jobs, ' + (res[0].data || []).length +
      ' deliverables for this job, ' + state.invoices.length + ' invoices.';
  }

  async function loadTenant(tenantId) {
    var seq = ++state.seq;
    state.tenantId = tenantId;
    notice('');
    var t = state.tenants.filter(function (x) { return x.id === tenantId; })[0];
    $('tenantName').textContent = t ? t.name : '';
    $('tenantMeta').textContent = t ? ('Tenant ' + t.code + (t.location ? ' \u00b7 ' + t.location : '')) : '';

    var res = await Promise.all([
      state.sb.from('tenant_stats').select(STAT_COLS).eq('tenant_id', tenantId).maybeSingle(),
      state.sb.from('jobs').select(JOB_COLS).eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      state.sb.from('invoices').select(INV_COLS).eq('tenant_id', tenantId).order('created_at', { ascending: false })
    ]);
    if (seq !== state.seq) return;
    for (var i = 0; i < res.length; i++) {
      if (res[i].error) { notice(explain(res[i].error)); return; }
    }
    renderStats(res[0].data);
    state.jobs = res[1].data || [];
    state.invoices = res[2].data || [];
    renderJobPicker();

    if (!state.jobs.length) {
      $('jobTitle').textContent = 'No jobs yet';
      $('pipe').innerHTML = ''; $('jobmeta').innerHTML = '';
      $('deliverables').innerHTML = '<p class="muted">Nothing here yet.</p>';
      $('invoice').innerHTML = '<p class="muted">Nothing here yet.</p>';
      $('history').innerHTML = '';
      return;
    }
    await loadJob(state.jobs[0].id, seq);
  }

  async function showApp(user) {
    state.user = user;
    show('loginView', false);
    show('appView', true);
    $('banner').textContent = 'Test build \u00b7 Stage 1 \u00b7 read-only';
    $('who').textContent = user.email || '';

    var t = await state.sb.from('tenants').select('id, code, name, location').order('code');
    if (t.error) { notice(explain(t.error)); return; }
    state.tenants = t.data || [];
    if (!state.tenants.length) {
      $('tenantName').textContent = 'No company linked to this login';
      notice('This login is not linked to a company yet. Ask Aerialist to add it.');
      return;
    }
    $('tenantSel').innerHTML = state.tenants.map(function (x) {
      return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>';
    }).join('');
    show('tenantPick', state.tenants.length > 1);
    await loadTenant(state.tenants[0].id);
  }

  /* ---------- events ---------- */

  function wire() {
    $('loginForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      setMsg('');
      var btn = $('loginBtn');
      btn.disabled = true;
      try {
        var r = await state.sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
        if (r.error) { setMsg(r.error.message); return; }
        $('password').value = '';
        await showApp(r.data.user);
      } catch (err) {
        setMsg('Sign-in failed. Try again.');
      } finally {
        btn.disabled = false;
      }
    });

    $('signOut').addEventListener('click', async function () {
      await state.sb.auth.signOut();
      showLogin();
    });

    $('tenantSel').addEventListener('change', function () { loadTenant(this.value); });

    $('jobSel').addEventListener('change', function () {
      var seq = ++state.seq;
      loadJob(this.value, seq);
    });
  }

  async function init() {
    if (!configured()) {
      show('loginView', true);
      $('loginForm').hidden = true;
      setMsg('Portal is not configured yet. Open config.js and paste in the Supabase project URL and publishable key.');
      return;
    }
    if (!window.supabase || !window.supabase.createClient) {
      show('loginView', true);
      $('loginForm').hidden = true;
      setMsg('The sign-in library did not load. Check your connection and reload.');
      return;
    }
    state.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);
    wire();
    var s = await state.sb.auth.getSession();
    if (s.data && s.data.session) {
      await showApp(s.data.session.user);
    } else {
      showLogin();
    }
    // Keep this callback free of Supabase calls: they can deadlock inside it.
    state.sb.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') showLogin();
    });
  }

  init();
})();
