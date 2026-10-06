/* Portal demo page. Everything here is a demo with made-up data: no network calls, nothing stored. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var paid = false;
  var lastFocus = null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Next flight is three weeks out, so the demo never looks stale.
  var nf = new Date();
  nf.setDate(nf.getDate() + 21);
  $('nextFlight').textContent = nf.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  /* ---------- pop-up ---------- */

  var modal = $('modal'), mTitle = $('mTitle'), mBody = $('mBody'), mAct = $('mAct'), mClose = $('mClose');

  function openModal(title, html, actLabel, onAct) {
    lastFocus = document.activeElement;
    mTitle.textContent = title;
    mBody.innerHTML = html;
    if (actLabel) {
      mAct.hidden = false;
      mAct.textContent = actLabel;
      mAct.onclick = onAct;
    } else {
      mAct.hidden = true;
      mAct.onclick = null;
    }
    modal.hidden = false;
    mClose.focus();
  }

  function closeModal() {
    modal.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  mClose.addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  /* ---------- actions ---------- */

  function downloadSampleCsv() {
    var day = new Date().toISOString().slice(0, 10);
    var csv = '# SAMPLE DATA - demo only, not a real flight\n' +
      'mission,date,aircraft,images,gsd_cm,qc\n' +
      '001-SAC-MAP-001,' + day + ',DJI Matrice 4E,180,1.56,passed\n';
    var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'sample-flight-log.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function simulatePayment() {
    if (paid) return;
    paid = true;

    $('badge3d').className = 'badge badge--ready';
    $('badge3d').textContent = 'Ready';
    var b = $('btn3d');
    b.className = 'btn';
    b.textContent = 'Download';
    b.setAttribute('data-demo', 'download');
    b.setAttribute('data-file', '3D textured model');
    b.setAttribute('data-detail', 'OBJ, 3.1 GB');

    $('statReady').textContent = '5';
    $('statAwaiting').textContent = '$0';
    $('invHead').textContent = 'Paid \u00b7 INV-001-SAC-014';
    $('btnPay').hidden = true;
    $('invNote').textContent = 'Payment received (demo). The 3D model is unlocked and the job is marked complete.';
    $('jobStatus').textContent = 'Paid';

    var del = $('pipeDelivery');
    del.className = 'pipe__step done';
    del.querySelector('.pipe__dot').textContent = '\u2713';
    var pay = $('pipePayment');
    pay.className = 'pipe__step done';
    pay.querySelector('.pipe__dot').textContent = '\u2713';

    var when = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    var row = document.createElement('div');
    row.className = 'hrow';
    row.innerHTML = '<span class="hstatus">Paid</span><span class="hnote">Payment received (demo)</span><span class="hdate">' + esc(when) + '</span>';
    $('history').appendChild(row);
  }

  function handle(btn) {
    var kind = btn.getAttribute('data-demo');
    var file = btn.getAttribute('data-file');
    var detail = btn.getAttribute('data-detail');

    if (kind === 'download') {
      openModal('Download: ' + file,
        '<p>Sample only. In a live account this button downloads <b>' + esc(file) + '</b> (' + esc(detail) +
        ') directly from Aerialist\'s secure storage. A file that is still locked cannot be downloaded.</p>');
    } else if (kind === 'download-log') {
      openModal('Flight log (sample)',
        '<p>This sample is a tiny CSV of made-up mission data, so you can see what a real download looks like.</p>',
        'Download sample CSV', downloadSampleCsv);
    } else if (kind === 'coi') {
      openModal('Certificate of Insurance (sample layout)',
        '<div class="sample">' +
        '<div class="line"><span>Certificate holder</span><b>Sample Aggregates Co.</b></div>' +
        '<div class="line"><span>Insured</span><b>Aerialist Drone Imaging LLC</b></div>' +
        '<div class="line"><span>Job</span><b>001-SAC-MAP-001</b></div>' +
        '<div class="line"><span>Coverage</span><b>Commercial general liability, including UAS operations</b></div>' +
        '<div class="line"><span>Limits and policy number</span><b>Shown on the real certificate</b></div>' +
        '</div><p class="fine">A job-specific certificate is pulled from the active policy for every engagement and posted here to review and print. This layout is an example only.</p>');
    } else if (kind === 'print') {
      openModal('Print (sample)', '<p>In a live account this opens your certificate in a print-ready view. Nothing prints in the demo.</p>');
    } else if (kind === 'invoice') {
      openModal('Invoice INV-001-SAC-014 (sample)',
        '<div class="sample">' +
        '<div class="line"><span>Description</span><b>Site mapping, 001-SAC-MAP-001</b></div>' +
        '<div class="line"><span>Includes</span><b>Orthomosaic, point cloud, flight log, 3D textured model</b></div>' +
        '<div class="line"><span>Amount due</span><b>$2,450.00</b></div>' +
        '</div><p class="fine">Sample invoice with made-up figures.</p>');
    } else if (kind === 'pay') {
      if (paid) {
        openModal('Already paid (demo)', '<p>This demo invoice is already paid. Use Reset demo to start over.</p>');
      } else {
        openModal('Pay now (demo)',
          '<p>In a live account this opens a secure Stripe checkout for <b>$2,450.00</b>. When the payment clears, the locked 3D model unlocks automatically and the job is marked complete.</p>' +
          '<p>Nothing is charged here. Simulate a successful payment to watch the page update.</p>',
          'Simulate payment', function () { simulatePayment(); closeModal(); });
      }
    }
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-demo]') : null;
    if (btn) handle(btn);
  });

  $('resetDemo').addEventListener('click', function () { window.location.reload(); });
})();
