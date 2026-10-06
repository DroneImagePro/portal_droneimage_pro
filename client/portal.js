/* Aerialist client portal (live build).
   Same layout as the V1 preview, wired to Supabase.
   What each login can see is enforced by the database rules (RLS), not by this file.
   Not wired yet: Stripe checkout (Pay now is disabled) and secure file storage (Cloudflare R2). */
(function () {
  'use strict';

  var cfg = window.PORTAL_CONFIG || {};
  var sb = null;
  var state = { user: null, tenants: [], tenantId: null, jobs: [], lockedByJob: {}, seq: 0 };

  var STEPS = ['Bid', 'Field', 'Processing', 'Delivery', 'Payment'];
  var STEP_INDEX = { bid_pending: 0, bid_accepted: 1, scheduled: 1, in_field: 1, processing: 2, in_delivery: 3, paid: 5, cancelled: -1 };
  var STATUS_LABEL = {
    bid_pending: 'Bid pending', bid_accepted: 'Bid accepted', scheduled: 'Scheduled', in_field: 'In the field',
    processing: 'Processing', in_delivery: 'In delivery', paid: 'Paid', cancelled: 'Cancelled'
  };
  var OPEN = ['paid', 'cancelled'];

  var JOB_COLS = 'id, tenant_id, job_code, title, status, job_type, address, scheduled_date, aircraft, image_count, gsd_cm, crs, ' +
    'processing_software, qc_passed, invoice_code, amount_cents, paid_at, created_at';
  // file_url is not readable by clients; download links come from deliverable_file_url().
  var DEL_COLS = 'id, job_id, name, file_type, size_bytes, locked, created_at';

  function $(id) { return document.getElementById(id); }
  function show(id, on) { $(id).hidden = !on; }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(cents) {
    return ((Number(cents) || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }
  function moneyShort(cents) {
    var s = money(cents);
    return s.slice(-3) === '.00' ? s.slice(0, -3) : s;
  }
  function fmtSize(n) {
    if (n == null) return '';
    n = Number(n);
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB';
    if (n >= 1e6) return Math.round(n / 1e6) + ' MB';
    if (n >= 1e3) return Math.round(n / 1e3) + ' KB';
    return n + ' B';
  }
  function fmtDate(s, withTime) {
    var d = new Date(s);
    if (!s || isNaN(d.getTime())) return '';
    var o = { month: 'short', day: 'numeric', year: 'numeric' };
    if (withTime) { o.hour = 'numeric'; o.minute = '2-digit'; }
    return d.toLocaleString('en-US', o);
  }

  function notice(t) { var n = $('notice'); n.textContent = t || ''; n.hidden = !t; }
  function loginMsg(t) { $('loginMsg').textContent = t || ''; }
  function explain(err) {
    var m = (err && err.message) ? err.message : 'Unknown error';
    return 'Could not load your data (' + m + '). Please call (747) 383-2282 if this keeps happening.';
  }

  /* ---------- views ---------- */

  function showLogin() {
    state = { user: null, tenants: [], tenantId: null, jobs: [], lockedByJob: {}, seq: state.seq + 1 };
    show('appView', false);
    show('loginView', true);
    show('who', false);
    show('signOut', false);
    notice('');
  }

  function showApp(user) {
    state.user = user;
    show('loginView', false);
    show('appView', true);
    $('who').textContent = user.email || '';
    show('who', true);
    show('signOut', true);
  }

  /* ---------- rendering ---------- */

  function renderStats(readyCount) {
    var active = 0, awaiting = 0, next = null, now = Date.now();
    state.jobs.forEach(function (j) {
      if (OPEN.indexOf(j.status) === -1) active++;
      if (!j.paid_at && j.amount_cents && j.status === 'in_delivery') awaiting += j.amount_cents;
      if (j.scheduled_date) {
        var t = new Date(j.scheduled_date).getTime();
        if (t >= now && (next === null || t < next)) next = t;
      }
    });
    $('statActive').textContent = String(active);
    $('statReady').textContent = String(readyCount);
    $('statAwaiting').textContent = moneyShort(awaiting);
    $('statNext').textContent = next ? new Date(next).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'None';
  }

  function jobLabel(j) {
    return (j.job_code ? j.job_code + ' — ' : '') + (j.title || j.job_type || 'Job');
  }

  function renderJobPicker() {
    $('jobSel').innerHTML = state.jobs.map(function (j) {
      return '<option value="' + esc(j.id) + '">' + esc(jobLabel(j)) + '</option>';
    }).join('');
    show('jobPick', state.jobs.length > 1);
  }

  function renderPipeline(job) {
    var c = STEP_INDEX[job.status];
    if (c === undefined) c = -1;
    $('pipe').innerHTML = STEPS.map(function (name, i) {
      var cls = c === -1 ? '' : (i < c ? 'done' : (i === c ? 'current' : ''));
      var dot = cls === 'done' ? '✓' : (cls === 'current' ? '●' : '');
      return '<div class="pipe__step ' + cls + '"><div class="pipe__dot">' + dot + '</div><div class="pipe__label">' + esc(name) + '</div></div>';
    }).join('');
  }

  function renderJobMeta(job) {
    var m = [];
    if (job.address) m.push('<b>Site:</b> ' + esc(job.address));
    if (job.aircraft) m.push('<b>Aircraft:</b> ' + esc(job.aircraft));
    if (job.image_count != null) m.push('<b>Images:</b> ' + esc(job.image_count));
    if (job.gsd_cm != null) m.push('<b>GSD:</b> ' + esc(job.gsd_cm) + ' cm');
    if (job.crs) m.push('<b>CRS:</b> ' + esc(job.crs));
    if (job.processing_software) m.push('<b>Processing:</b> ' + esc(job.processing_software));
    if (job.qc_passed != null) m.push('<b>QC:</b> ' + (job.qc_passed ? '<span class="ok">Passed</span>' : '<span class="warn">Not passed</span>'));
    $('jobmeta').innerHTML = m.join(' &nbsp;&middot;&nbsp; ');
    show('jobmeta', m.length > 0);
  }

  function renderDeliverables(job, list) {
    var locked = state.lockedByJob[job.id] || 0;
    var rows = list.map(function (d) {
      var detail = [d.file_type, fmtSize(d.size_bytes)].filter(Boolean).join(' · ');
      return '<div class="drow">' +
        '<div class="dname"><span class="n">' + esc(d.name || 'Deliverable') + '</span><span class="m">' + esc(detail) + '</span></div>' +
        '<span class="badge badge--ready">Ready</span>' +
        '<button class="btn" type="button" data-download="' + esc(d.id) + '">Download</button>' +
        '</div>';
    });
    if (locked) {
      rows.push('<div class="drow">' +
        '<div class="dname"><span class="n">' + locked + (locked === 1 ? ' file unlocks' : ' files unlock') + ' after payment</span>' +
        '<span class="m">Released automatically once the invoice is paid</span></div>' +
        '<span class="badge badge--locked">Locked</span>' +
        '<a class="btn btn--ghost" href="#invoice">See invoice</a>' +
        '</div>');
    }
    $('deliverables').innerHTML = rows.length ? rows.join('') : '<p class="muted">No deliverables for this job yet.</p>';
  }

  function renderInvoice(job) {
    if (!job.amount_cents) {
      $('invoice').innerHTML = '<p class="muted">No invoice for this job yet.</p>';
      return;
    }
    var paid = !!job.paid_at;
    var head = (paid ? 'Paid' : 'Balance due') + (job.invoice_code ? ' · ' + job.invoice_code : '');
    $('invoice').innerHTML = '<div class="invoice"><div class="invoice__amt"><small>' + esc(head) + '</small>' +
      esc(money(job.amount_cents)) + '</div><div class="actions">' +
      (paid ? '' : '<button class="btn btn--solid" type="button" disabled title="Online payment is coming soon">Pay now</button>') +
      '</div></div>' +
      '<p class="note">' + (paid
        ? 'Paid ' + esc(fmtDate(job.paid_at)) + '. Thank you.'
        : 'Online payment is coming soon. To pay now, call (747) 383-2282. Locked files unlock once payment clears.') + '</p>';
  }

  function renderHistory(events) {
    $('history').innerHTML = events.length ? events.map(function (e) {
      return '<div class="hrow"><span class="hstatus">' + esc(STATUS_LABEL[e.status] || e.status) + '</span>' +
        '<span class="hnote">' + esc(e.note || '') + '</span><span class="hdate">' + esc(fmtDate(e.created_at, true)) + '</span></div>';
    }).join('') : '<p class="muted">No history yet.</p>';
  }

  function clearJob(msg) {
    $('jobTitle').textContent = msg;
    $('pipe').innerHTML = '';
    show('jobmeta', false);
    $('deliverables').innerHTML = '<p class="muted">Nothing here yet.</p>';
    $('invoice').innerHTML = '<p class="muted">Nothing here yet.</p>';
    $('history').innerHTML = '<p class="muted">Nothing here yet.</p>';
  }

  /* ---------- data ---------- */

  async function loadJob(jobId, seq) {
    var job = state.jobs.filter(function (j) { return String(j.id) === String(jobId); })[0];
    if (!job) return;
    $('jobTitle').textContent = jobLabel(job) + ' · ' + (STATUS_LABEL[job.status] || job.status || '');
    renderPipeline(job);
    renderJobMeta(job);
    renderInvoice(job);

    var res = await Promise.all([
      sb.from('deliverables').select(DEL_COLS).eq('job_id', job.id).order('created_at'),
      sb.from('job_events').select('status, note, created_at').eq('job_id', job.id).order('created_at')
    ]);
    if (seq !== state.seq) return;
    if (res[0].error) { notice(explain(res[0].error)); return; }
    if (res[1].error) { notice(explain(res[1].error)); return; }
    renderDeliverables(job, res[0].data || []);
    renderHistory(res[1].data || []);
  }

  async function loadTenant(tenantId) {
    var seq = ++state.seq;
    state.tenantId = tenantId;
    notice('');
    var t = state.tenants.filter(function (x) { return String(x.id) === String(tenantId); })[0] || {};
    $('tenantName').innerHTML = 'Welcome back,<br>' + esc(t.name || '');
    $('tenantMeta').textContent = [t.code ? 'Tenant ' + t.code : '', t.location || ''].filter(Boolean).join(' · ');

    var res = await Promise.all([
      sb.from('jobs').select(JOB_COLS).eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      sb.from('deliverables').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('locked', false),
      sb.rpc('job_locked_counts')
    ]);
    if (seq !== state.seq) return;
    for (var i = 0; i < res.length; i++) { if (res[i].error) { notice(explain(res[i].error)); return; } }

    state.jobs = res[0].data || [];
    state.lockedByJob = {};
    (res[2].data || []).forEach(function (r) { state.lockedByJob[r.job_id] = Number(r.locked_count) || 0; });
    renderStats(res[1].count || 0);
    renderJobPicker();
    if (!state.jobs.length) { clearJob('No jobs yet'); return; }
    await loadJob(state.jobs[0].id, seq);
  }

  async function start(user) {
    showApp(user);
    var t = await sb.from('tenants').select('id, name, code, location').order('name');
    if (t.error) { notice(explain(t.error)); return; }
    state.tenants = t.data || [];
    if (!state.tenants.length) {
      $('tenantName').textContent = 'No company linked to this login';
      clearJob('');
      notice('This login is not linked to a company yet. Call (747) 383-2282 and we will set it up.');
      return;
    }
    $('tenantSel').innerHTML = state.tenants.map(function (x) {
      return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>';
    }).join('');
    show('tenantPick', state.tenants.length > 1);
    await loadTenant(state.tenants[0].id);
  }

  async function download(btn) {
    var id = Number(btn.getAttribute('data-download'));
    btn.disabled = true;
    try {
      var r = await sb.rpc('deliverable_file_url', { p_deliverable_id: id });
      if (r.error) { notice(explain(r.error)); return; }
      var url = r.data;
      if (url && /^https:\/\//i.test(url)) {
        window.open(url, '_blank', 'noopener');
      } else {
        notice('This file is not available for download yet. Call (747) 383-2282 and we will send it.');
      }
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- events ---------- */

  function wire() {
    $('loginForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      loginMsg('');
      var email = $('email').value.trim(), pw = $('password').value;
      if (!email || !pw) { loginMsg('Enter your email and password.'); return; }
      var btn = $('loginBtn');
      btn.disabled = true;
      try {
        var r = await sb.auth.signInWithPassword({ email: email, password: pw });
        if (r.error) { loginMsg('That email and password did not match.'); return; }
        $('password').value = '';
        await start(r.data.user);
      } catch (err) {
        loginMsg('Sign-in failed. Check your connection and try again.');
      } finally {
        btn.disabled = false;
      }
    });

    $('signOut').addEventListener('click', async function () {
      await sb.auth.signOut();
      showLogin();
    });

    $('tenantSel').addEventListener('change', function () { loadTenant(this.value); });
    $('jobSel').addEventListener('change', function () { loadJob(this.value, ++state.seq); });

    $('deliverables').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-download]') : null;
      if (btn) download(btn);
    });
  }

  async function init() {
    if (!window.supabase || !window.supabase.createClient || !cfg.SUPABASE_URL) {
      show('loginView', true);
      $('loginForm').hidden = true;
      loginMsg('The portal could not load. Check your connection and reload the page.');
      return;
    }
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);
    wire();
    var s = await sb.auth.getSession();
    if (s.data && s.data.session) await start(s.data.session.user);
    else showLogin();
    // No Supabase calls inside this callback: they can deadlock.
    sb.auth.onAuthStateChange(function (event) { if (event === 'SIGNED_OUT') showLogin(); });
  }

  init();
})();
