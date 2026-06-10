/* =====================================================================
   MaStartup AI - Onboarding & Startup Creation Wizard (NovaWizard)
   Two flows backed by Bootstrap modals defined in index.html:
   1. Onboarding   (#onboardModal)  - first run, creates a workspace.
   2. Startup wizard (#wizardModal) - multi-step startup creation.
   ===================================================================== */
(function (global) {
  'use strict';

  /* --------------------------- ONBOARDING ----------------------------- */
  var onbStep = 1, onbTotal = 3, onbData = {};

  function startOnboarding() {
    onbStep = 1; onbData = {};
    renderOnb();
    bsModal('onboardModal').show();
  }
  function onbNext() {
    if (onbStep === 1) {
      var name = val('onbName'); if (!name) return shake('onbName');
      onbData.name = name; onbData.role = val('onbRole');
    } else if (onbStep === 2) {
      onbData.workspace = val('onbWorkspace') || (onbData.name.split(' ')[0] + "'s Workspace");
      onbData.country = val('onbCountry');
    }
    if (onbStep < onbTotal) { onbStep++; renderOnb(); }
  }
  function onbBack() { if (onbStep > 1) { onbStep--; renderOnb(); } }
  function onbFinish() {
    NovaStore.updateUser({ name: onbData.name, country: onbData.country || '' });
    NovaStore.createWorkspace({ name: onbData.workspace });
    NovaStore.updateSettings({}); // persist
    var st = NovaStore.raw();
    st.onboarded = true;
    NovaStore.persist();
    // mark onboarded via direct flag
    localStorage.setItem('nova.onboarded', '1');
    bsModal('onboardModal').hide();
    if (global.onOnboardingComplete) global.onOnboardingComplete(onbData);
  }
  function renderOnb() {
    setText('onbStepLabel', 'Step ' + onbStep + ' of ' + onbTotal);
    var bar = document.getElementById('onbProgress'); if (bar) bar.style.width = (onbStep / onbTotal * 100) + '%';
    show('onbPane1', onbStep === 1); show('onbPane2', onbStep === 2); show('onbPane3', onbStep === 3);
    show('onbBackBtn', onbStep > 1);
    show('onbNextBtn', onbStep < onbTotal);
    show('onbFinishBtn', onbStep === onbTotal);
    if (onbStep === 3) {
      setText('onbSummaryName', onbData.name || '—');
      setText('onbSummaryWs', onbData.workspace || '—');
      setText('onbSummaryCountry', onbData.country || 'Not set');
    }
  }

  /* ------------------------ STARTUP WIZARD ----------------------------- */
  var wzStep = 1, wzTotal = 4, wzData = {};

  function startWizard() {
    wzStep = 1; wzData = {};
    global._wzLogoData = null;
    ['wzName', 'wzCountry', 'wzMarket', 'wzProblem', 'wzSolution'].forEach(function (id) { var e = document.getElementById(id); if (e) e.value = ''; });
    var lf = document.getElementById('wzLogo'); if (lf) lf.value = '';
    var lp = document.getElementById('wzLogoPreview'); if (lp) lp.innerHTML = '<i class="fa-solid fa-image" style="color:var(--tx3)"></i>';
    renderWz();
    bsModal('wizardModal').show();
  }
  function wzNext() {
    if (wzStep === 1) {
      var n = val('wzName'); if (!n) return shake('wzName');
      wzData.name = n; wzData.industry = val('wzIndustry'); wzData.stage = val('wzStage');
    } else if (wzStep === 2) {
      wzData.country = val('wzCountry'); wzData.market = val('wzMarket');
    } else if (wzStep === 3) {
      wzData.problem = val('wzProblem'); wzData.solution = val('wzSolution');
    }
    if (wzStep < wzTotal) { wzStep++; renderWz(); }
  }
  function wzBack() { if (wzStep > 1) { wzStep--; renderWz(); } }
  function wzFinish() {
    if (global._wzLogoData) wzData.logo = global._wzLogoData;
    var startup = NovaStore.createStartup(wzData);
    // seed durable memory from the wizard
    if (wzData.problem) NovaStore.addMemory(startup.id, 'Problem: ' + wzData.problem);
    if (wzData.solution) NovaStore.addMemory(startup.id, 'Solution: ' + wzData.solution);
    global._wzLogoData = null;
    bsModal('wizardModal').hide();
    if (global.onStartupCreated) global.onStartupCreated(startup);
  }
  function renderWz() {
    setText('wzStepLabel', 'Step ' + wzStep + ' of ' + wzTotal);
    var bar = document.getElementById('wzProgress'); if (bar) bar.style.width = (wzStep / wzTotal * 100) + '%';
    for (var i = 1; i <= wzTotal; i++) show('wzPane' + i, wzStep === i);
    show('wzBackBtn', wzStep > 1);
    show('wzNextBtn', wzStep < wzTotal);
    show('wzFinishBtn', wzStep === wzTotal);
    // step dots
    document.querySelectorAll('#wzDots .wz-dot').forEach(function (d, idx) {
      d.classList.toggle('on', idx < wzStep);
    });
    if (wzStep === 4) {
      setText('wzSumName', val('wzName') || wzData.name || '—');
      setText('wzSumIndustry', val('wzIndustry') || wzData.industry || '—');
      setText('wzSumCountry', val('wzCountry') || wzData.country || '—');
      setText('wzSumProblem', val('wzProblem') || wzData.problem || '—');
    }
  }

  /* ----------------------------- helpers ------------------------------ */
  function bsModal(id) { return bootstrap.Modal.getOrCreateInstance(document.getElementById(id)); }
  function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }
  function setText(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
  function show(id, on) { var e = document.getElementById(id); if (e) e.style.display = on ? '' : 'none'; }
  function shake(id) { var e = document.getElementById(id); if (e) { e.classList.add('is-invalid'); e.focus(); setTimeout(function () { e.classList.remove('is-invalid'); }, 1200); } }

  global.NovaWizard = {
    startOnboarding: startOnboarding, onbNext: onbNext, onbBack: onbBack, onbFinish: onbFinish,
    startWizard: startWizard, wzNext: wzNext, wzBack: wzBack, wzFinish: wzFinish
  };
})(window);
