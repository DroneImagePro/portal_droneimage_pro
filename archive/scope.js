/* Portal front page: "Scope a job" flow. No network calls and nothing stored.
   The summary is built in the browser, and the visitor sends it by email or text. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var form = $('scopeForm');
  if (!form) return;

  var TOTAL = 3;
  var step = 1;
  var EMAIL = 'fly@droneimage.pro';
  var PHONE = '+17473832282';

  function stepEl(n) { return form.querySelector('[data-step="' + n + '"]'); }

  function showStep(n, focus) {
    step = n;
    for (var i = 1; i <= TOTAL; i++) stepEl(i).hidden = (i !== n);
    $('stepLabel').textContent = 'Step ' + n + ' of ' + TOTAL;
    $('scopeBack').hidden = (n === 1);
    $('scopeNext').textContent = (n === TOTAL) ? 'Review my scope' : 'Next';
    setMsg('');
    if (focus) {
      var first = stepEl(n).querySelector('select, input');
      if (first) first.focus();
    }
  }

  function setMsg(t) { $('scopeMsg').textContent = t || ''; }

  function val(id) { return ($(id).value || '').trim(); }

  function validate(n) {
    if (n === 1) {
      if (!val('svc')) { setMsg('Choose the kind of job.'); $('svc').focus(); return false; }
      if (!val('siteType')) { setMsg('Choose the kind of site.'); $('siteType').focus(); return false; }
    }
    if (n === 3) {
      if (!val('cName')) { setMsg('Enter your name.'); $('cName').focus(); return false; }
      var phone = val('cPhone').replace(/\D/g, '');
      var email = val('cEmail');
      if (phone.length < 10 && !email) { setMsg('Enter a phone number or an email so we can reply.'); $('cPhone').focus(); return false; }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setMsg('That email does not look right.'); $('cEmail').focus(); return false; }
    }
    return true;
  }

  function deliverables() {
    var out = [];
    form.querySelectorAll('input[name="deliv"]:checked').forEach(function (c) { out.push(c.value); });
    return out.length ? out.join(', ') : 'Not sure, recommend for me';
  }

  function buildSummary() {
    var lines = [
      'Job scope request (from the portal page)',
      '',
      'Job: ' + val('svc'),
      'Site type: ' + val('siteType'),
      'Size: ' + (val('size') || 'Not given'),
      'Site location: ' + (val('loc') || 'Not given'),
      'Timing: ' + (val('timing') || 'Not given'),
      'Repeat visits: ' + (val('freq') || 'Not given'),
      'Deliverables: ' + deliverables(),
      'Site requirements: ' + (val('access') || 'Not given'),
      '',
      'Name: ' + val('cName'),
      'Company: ' + (val('cCompany') || 'Not given'),
      'Phone: ' + (val('cPhone') || 'Not given'),
      'Email: ' + (val('cEmail') || 'Not given'),
      'Best way to reach me: ' + (val('cPrefer') || 'Any')
    ];
    return lines.join('\n');
  }

  function showDone() {
    var summary = buildSummary();
    $('scopeSummary').textContent = summary;
    var subject = 'Job scope request';
    $('sendEmail').href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(summary);
    $('sendText').href = 'sms:' + PHONE + '?&body=' + encodeURIComponent(summary);
    form.hidden = true;
    $('scopeIntro').hidden = true;
    $('scopeDone').hidden = false;
    var h = $('doneTitle');
    h.focus();
    if (h.scrollIntoView) h.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function restart() {
    form.reset();
    form.hidden = false;
    $('scopeIntro').hidden = false;
    $('scopeDone').hidden = true;
    $('copySummary').textContent = 'Copy summary';
    showStep(1, true);
  }

  function copySummary() {
    var text = $('scopeSummary').textContent;
    var btn = $('copySummary');
    function ok() { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy summary'; }, 2000); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { btn.textContent = 'Press and hold the text to copy'; });
    } else {
      btn.textContent = 'Press and hold the text to copy';
    }
  }

  $('scopeNext').addEventListener('click', function () {
    if (!validate(step)) return;
    if (step < TOTAL) showStep(step + 1, true); else showDone();
  });
  $('scopeBack').addEventListener('click', function () { if (step > 1) showStep(step - 1, true); });
  $('scopeRestart').addEventListener('click', restart);
  $('copySummary').addEventListener('click', copySummary);
  form.addEventListener('submit', function (e) { e.preventDefault(); $('scopeNext').click(); });

  showStep(1, false);
})();
