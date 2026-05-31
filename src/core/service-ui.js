/* ============================================================
   LabOS — Core service layer (split into cohesive units during
   the module migration). Each unit is a self-contained singleton
   that shares the ordered-script global scope with the app layer,
   exactly as before — but now in its own reviewable file, which is
   the prerequisite for a later true-ESM cutover once app.views.js
   is itself split into modules.
   ============================================================ */

/* Service UI — connection/licence badges, overlay, device + sync panels. */

/* ==========================================================
   CONNECTION BADGE (in topbar — replaces static pill)
   ========================================================== */
function renderConnectionBadge(){
  const pill = document.querySelector('.offline-pill');
  if(!pill) return;
  const s = OfflineCore.state;
  const pending = OfflineCore.pendingCount;

  if(!s.online){
    pill.style.background = '#FCEFD4';
    pill.style.color      = '#7A5410';
    pill.innerHTML = `<span class="pulse" style="background:#C77B14"></span>Offline${pending?' · '+pending+' queued':''}`;
    pill.title = `You are offline. ${pending} change${pending===1?'':'s'} queued. They'll sync when reconnected.`;
  } else if(s.syncing){
    pill.style.background = '#E1ECFB';
    pill.style.color      = '#1F4B86';
    pill.innerHTML = `<span class="pulse" style="background:#1F4B86;animation:pulseDot 1s infinite"></span>Syncing… ${pending} pending`;
    pill.title = 'Syncing changes to server.';
  } else if(pending > 0){
    pill.style.background = '#FFF4E0';
    pill.style.color      = '#7A5410';
    pill.innerHTML = `<span class="pulse" style="background:#C77B14"></span>${pending} pending`;
    pill.title = `${pending} change${pending===1?' is':'s are'} pending sync. Click to retry.`;
  } else {
    pill.style.background = '';
    pill.style.color      = '';
    pill.innerHTML = `<span class="pulse"></span>Online · Synced`;
    pill.title = s.lastSyncedAt ? `Last sync: ${new Date(s.lastSyncedAt).toLocaleTimeString()}` : 'All changes synced.';
  }
  pill.style.cursor = 'pointer';
  pill.onclick = openSyncPanel;
}

/* ==========================================================
   LICENCE BADGE + GRACE BANNER + LOCKOUT OVERLAY
   ========================================================== */
function renderLicenceBadge(){
  const pill = document.getElementById('licence-pill');
  if(!pill) return;
  const s = LicenseCore.state;
  pill.classList.remove('grace','lockout');
  const lic = s.licence || {};
  const days = s.daysUntilLockout;
  if(s.status === 'valid'){
    pill.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Licensed · ${esc(lic.planName || lic.plan || 'Active')}`;
    pill.title = `${lic.legalName || ''} · Valid until ${lic.validUntil ? new Date(lic.validUntil).toLocaleDateString() : ''}`;
  } else if(s.status === 'grace'){
    pill.classList.add('grace');
    pill.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Grace · ${days != null ? days+'d left' : ''}`;
    pill.title = `Read-only mode. Reconnect within ${days || 0} day${days===1?'':'s'} to avoid lockout.`;
  } else if(s.status === 'lockout'){
    pill.classList.add('lockout');
    pill.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><line x1="9" y1="16" x2="15" y2="16"/></svg> Locked`;
    pill.title = 'Licence locked. Contact support@agorox.africa to restore.';
  } else if(s.status === 'unregistered'){
    pill.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Not registered`;
    pill.title = 'This device is not registered. Complete onboarding to activate.';
  } else {
    pill.innerHTML = 'Verifying…';
  }
  renderLicenceOverlay();
  renderLicenceBanner();
}

// Banner across top of content area when in grace mode
function renderLicenceBanner(){
  const old = document.getElementById('licence-banner');
  if(old) old.remove();
  const s = LicenseCore.state;
  if(s.status !== 'grace') return;
  const lic = s.licence || {};
  const banner = document.createElement('div');
  banner.id = 'licence-banner';
  banner.className = 'licence-banner grace';
  const reason = s.lastError === 'expired'
    ? `Subscription expired ${lic.validUntil ? new Date(lic.validUntil).toLocaleDateString() : ''}. `
    : s.lastError === 'heartbeat_timeout'
    ? `Device hasn't reached the licence server for ${s.daysOfflineGrace} days. `
    : 'Licence verification needs attention. ';
  const days = s.daysUntilLockout != null ? s.daysUntilLockout : 0;
  banner.innerHTML = `
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    <div><b>Grace mode (read-only):</b> ${esc(reason)}You have <b>${days} day${days===1?'':'s'}</b> to restore before this device locks out. Existing work in progress can be completed; no new patients, requests, or invoices can be created.</div>
    <button onclick="LicenseCore.heartbeat();setTimeout(renderLicenceBadge,500)">Retry now</button>
  `;
  // Insert below the topbar, before content
  const app = document.getElementById('app');
  const topbar = app ? app.querySelector('.topbar') : null;
  if(topbar && topbar.parentNode){
    topbar.parentNode.insertBefore(banner, topbar.nextSibling);
  }
}

// Full-screen overlay when locked out
function renderLicenceOverlay(){
  const old = document.getElementById('licence-lockout-overlay');
  const s = LicenseCore.state;
  if(s.status !== 'lockout'){
    if(old) old.remove();
    return;
  }
  if(old) return; // already showing
  const reasonText = {
    bad_signature:  'The licence file on this device has been tampered with or is corrupted.',
    expired:        'Your subscription expired and the grace period has elapsed.',
    not_yet_valid:  'This licence is not yet valid.',
    unsigned:       'The licence on this device is missing its signature.',
    licence_revoked:'Your subscription has been suspended by the platform.',
    device_revoked: 'This device was deregistered by an administrator.',
    device_deregistered:'This device is no longer registered to your lab.',
    no_licence:     'No licence found on this device.',
    heartbeat_timeout: 'This device has been offline beyond the allowed grace period.'
  }[s.lastError] || 'Licence verification failed.';
  const overlay = document.createElement('div');
  overlay.id = 'licence-lockout-overlay';
  overlay.className = 'licence-lockout';
  overlay.innerHTML = `
    <div class="licence-lockout-card">
      <svg class="lockicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><line x1="9" y1="16" x2="15" y2="16"/></svg>
      <h2>This LabOS device is locked</h2>
      <p>${esc(reasonText)}</p>
      <div class="reason">Reason code: <b>${esc(s.lastError || 'unknown')}</b></div>
      <p>Patient data on this device is safe and unchanged. To restore access, contact your administrator or AgoroX support.</p>
      <div class="actions">
        <button onclick="LicenseCore.heartbeat();setTimeout(renderLicenceBadge,500)">Retry verification</button>
        <button class="primary" onclick="navigate('help')">Contact support</button>
      </div>
      <p style="font-size:11px;color:var(--ink-faint);margin-top:18px">Device fingerprint: <span style="font-family:var(--font-mono)">${esc(LicenseCore.state.device ? LicenseCore.state.device.fingerprint : 'unregistered')}</span></p>
    </div>
  `;
  document.body.appendChild(overlay);
}

/* ==========================================================
   DEVICE MANAGEMENT PAGE
   ========================================================== */
function renderDevices(root){
  const t = currentTenant();
  if(!t){ root.innerHTML = '<div class="page-header"><div class="page-title">Devices</div></div><div class="empty-state">No active tenant.</div>'; return; }
  const devices = LicenseCore.listDevices(t.id);
  const lic = LicenseCore.state.licence || {};
  const ents = lic.entitlements || {};
  const maxDevices = ents.maxDevices || 5;
  const myDevice = LicenseCore.state.device;
  root.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title" style="display:flex;align-items:center;gap:10px">${sectionIcon('devices', 24)} Registered devices</div>
        <div class="page-subtitle">${devices.length} of ${maxDevices} devices registered to ${esc(lic.legalName || t.name)}</div>
      </div>
      <div class="actions">
        <button class="btn" onclick="LicenseCore.heartbeat();setTimeout(()=>navigate('devices'),500)">Refresh</button>
      </div>
    </div>

    <div class="stats-grid" style="margin-bottom:20px">
      <div class="stat-card"><div class="stat-label">Active devices</div><div class="stat-value">${devices.length}</div><div class="stat-trend">${devices.length >= maxDevices ? '⚠ At plan limit' : 'of '+maxDevices+' allowed'}</div></div>
      <div class="stat-card"><div class="stat-label">Plan</div><div class="stat-value" style="font-size:18px">${esc(lic.planName || lic.plan || '—')}</div><div class="stat-trend">${lic.validUntil ? 'Renews '+new Date(lic.validUntil).toLocaleDateString() : ''}</div></div>
      <div class="stat-card"><div class="stat-label">Last heartbeat</div><div class="stat-value" style="font-size:18px">${LicenseCore.state.lastVerifiedAt ? new Date(LicenseCore.state.lastVerifiedAt).toLocaleString() : '—'}</div><div class="stat-trend">${LicenseCore.state.status === 'valid' ? '✓ Verified' : LicenseCore.state.status}</div></div>
    </div>

    <div class="panel">
      <div class="panel-header"><div class="panel-title">All devices</div></div>
      <div class="panel-body flush">
        ${devices.length === 0 ? emptyState({icon:'💻', title:'No devices registered', msg:'When a lab installs LabOS on a tablet, laptop, or kiosk, it shows up here.'}) : devices.map(d => {
          const isMe = myDevice && d.id === myDevice.id;
          const lastSync = d.lastSyncAt ? new Date(d.lastSyncAt).toLocaleString() : 'Never';
          return `
            <div class="device-row">
              <div>
                <div class="device-label">
                  ${esc(d.label || 'Device')}
                  ${isMe ? '<span class="device-this">This device</span>' : ''}
                </div>
                <div class="device-meta">${esc(d.fingerprint.substring(0,16))}… · registered ${d.registeredAt ? new Date(d.registeredAt).toLocaleDateString() : '—'}</div>
              </div>
              <div class="device-time">Last sync<br><b>${esc(lastSync)}</b></div>
              <button onclick="confirmDeregisterDevice('${esc(d.id)}', '${esc(d.label || 'this device')}', ${isMe})" ${isMe?'title="Deregister this device (you will be signed out)"':''}>Deregister</button>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <div class="panel" style="margin-top:16px">
      <div class="panel-header"><div class="panel-title">About device licensing</div></div>
      <div class="panel-body">
        <div style="font-size:13px;line-height:1.7;color:var(--ink-soft)">
          <p style="margin-top:0"><b>Each device counts against your plan's device cap.</b> When you install LabOS on a new tablet, laptop, or kiosk, it registers automatically on first launch.</p>
          <p>If you reach your cap, the next device is refused. Deregister an unused device from this page to free a slot.</p>
          <p><b>Lost or stolen device?</b> Deregister it immediately here. The next time the device comes online, it will lock out and refuse all access. Patient data already on that device cannot be exfiltrated through the LabOS app, but if the device itself was compromised, follow your incident-response procedure.</p>
          <p style="margin-bottom:0"><b>Your subscription plan:</b> ${esc(lic.planName || lic.plan || '—')} (${maxDevices} device${maxDevices===1?'':'s'} included). To increase your device cap, upgrade your plan from Subscription &amp; Billing.</p>
        </div>
      </div>
    </div>
  `;
}

function confirmDeregisterDevice(deviceId, label, isMe){
  const msg = isMe
    ? `Deregister this device? You'll be signed out and the next person to use it will have to re-register from scratch. You can deregister at most one device every 24 hours.`
    : `Deregister "${label}"? The next time that device comes online it will lock out and refuse all access. This action is logged in the audit trail.`;
  if(!confirm(msg)) return;
  const t = currentTenant();
  const result = LicenseCore.deregisterDevice(t.id, deviceId);
  if(result.ok){
    if(typeof toast === 'function') toast(`${label} deregistered.`, {type:'success', title:'Device removed'});
    if(isMe){
      // We deregistered ourselves — go through onboarding next time
      setTimeout(()=>location.reload(), 1500);
    } else {
      navigate('devices');
    }
  } else {
    if(typeof toast === 'function') toast(`Couldn't deregister: ${result.error}`, {type:'error'});
  }
}

/* ==========================================================
   SYNC PANEL — view & manage the outbox
   ========================================================== */
function openSyncPanel(){
  const s = OfflineCore.state;
  const items = s.outbox.slice().reverse(); // newest first
  const total = items.length;
  const synced = items.filter(e=>e.status==='synced').length;
  const pending = items.filter(e=>e.status==='pending'||e.status==='queued').length;
  const failed = items.filter(e=>e.status==='failed').length;
  const syncing = items.filter(e=>e.status==='syncing').length;

  const html = `
    <div class="modal-header">
      <div>
        <div class="modal-title">Sync &amp; offline status</div>
        <div class="muted-sm">${s.online ? 'Connected to LabOS cloud' : 'Working offline — changes saved locally'}</div>
      </div>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body" style="max-height:70vh;overflow-y:auto">

      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-card"><div class="stat-label">Connection</div><div class="stat-value" style="color:${s.online?'#1B6B3A':'#9A1F1F'};font-size:16px">${s.online?'Online ✓':'Offline'}</div></div>
        <div class="stat-card"><div class="stat-label">Pending sync</div><div class="stat-value">${pending+syncing}</div></div>
        <div class="stat-card"><div class="stat-label">Synced</div><div class="stat-value" style="color:#1B6B3A">${synced}</div></div>
        <div class="stat-card"><div class="stat-label">Failed</div><div class="stat-value" style="color:${failed?'#9A1F1F':'inherit'}">${failed}</div></div>
      </div>

      <div class="kv-grid" style="grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px">
        <div class="kv"><div class="k">Last saved locally</div><div class="v">${s.lastSaved ? new Date(s.lastSaved).toLocaleString() : '<span class="muted-sm">Never</span>'}</div></div>
        <div class="kv"><div class="k">Last sync</div><div class="v">${s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : '<span class="muted-sm">Never</span>'}</div></div>
        <div class="kv"><div class="k">Local storage</div><div class="v">${(s.localBytes/1024).toFixed(1)} KB used</div></div>
        <div class="kv"><div class="k">Total operations</div><div class="v">${total} since first run</div></div>
      </div>

      ${failed > 0 ? `
      <div class="alert-banner danger" style="margin-bottom:14px">
        <span class="icon">⚠</span>
        <div><b>${failed} operation${failed===1?'':'s'} failed to sync.</b> Retry from the button below; if persistent, contact support.</div>
      </div>` : ''}

      ${!s.online ? `
      <div class="alert-banner warn" style="margin-bottom:14px">
        <span class="icon">📡</span>
        <div><b>You're working offline.</b> Every action you take is saved locally on this device and queued. When connectivity returns, the queue will replay automatically. Don't switch tenants until you reconnect.</div>
      </div>` : ''}

      <div class="section-divider"><span class="label">Recent operations (${Math.min(items.length, 30)} of ${total})</span><div class="line"></div></div>

      ${items.length === 0 ? '<div style="padding:24px;text-align:center;color:var(--ink-soft);font-size:13px">No operations recorded yet.</div>' :
        '<table class="table" style="font-size:12px">' +
        '<thead><tr><th>Time</th><th>Operation</th><th>Tenant</th><th>Status</th></tr></thead>' +
        '<tbody>' +
        items.slice(0, 30).map(e=>{
          const cls = e.status==='synced' ? 'active' : e.status==='failed' ? 'past_due' : e.status==='syncing' ? 'trial' : 'trial';
          const time = new Date(e.createdAt).toLocaleString();
          return `<tr>
            <td class="muted-sm" style="white-space:nowrap">${time}</td>
            <td><b>${esc(e.summary || e.type)}</b><div class="muted-sm">${e.type}${e.attempts>1?' · '+e.attempts+' attempts':''}</div></td>
            <td class="muted-sm">${esc(e.tenantId || '—')}</td>
            <td><span class="tnt-status ${cls}">${e.status}</span></td>
          </tr>`;
        }).join('') +
        '</tbody></table>'}

    </div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Close</button>
      ${failed > 0 ? '<button class="btn" onclick="OfflineCore.retryFailed();closeModal();toast(\'Retrying failed operations...\',{type:\'info\'})">Retry failed</button>' : ''}
      <button class="btn" onclick="if(confirm(\'Clear all local data?\\n\\nThis removes your saved session, cached records, and any unsynced changes from this device. You will be returned to the start screen.\\n\\nThis cannot be undone.\')){OfflineCore.clearAll();setTimeout(function(){location.reload();},150);}" style="background:#9A1F1F;border-color:#7A1414;color:#fff">Clear local data</button>
    </div>`;

  document.getElementById('modal-root').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:720px">${html}</div></div>`;
}


/* ==========================================================
   BOOTSTRAP
   ========================================================== */
