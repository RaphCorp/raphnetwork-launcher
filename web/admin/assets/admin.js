(() => {
  const initialSection = window.__ADMIN_BOOTSTRAP__?.initialSection || 'overview';

  const state = {
    csrfToken: null,
    user: window.__ADMIN_BOOTSTRAP__?.user || null,
    authenticated: Boolean(window.__ADMIN_BOOTSTRAP__?.authenticated),
    activeSection: initialSection,
    sectionAccess: {
      overview: true,
      instances: true,
      files: true,
      users: true,
      permissions: true,
      launcher: true,
      settings: true
    },
    overview: null,
    instances: [],
    users: [],
    roles: {},
    rolesMeta: {},
    builtinRoles: [],
    permissions: [],
    settings: {},
    launcher: {
      config: {},
      news: []
    },
    userEditorId: null,
    file: {
      instanceId: '',
      path: '',
      selectedFile: '',
      selectedPaths: [],
      content: '',
      items: [],
      writable: false
    }
  };

  const els = {
    loginView: document.getElementById('loginView'),
    adminView: document.getElementById('adminView'),
    loginForm: document.getElementById('loginForm'),
    loginError: document.getElementById('loginError'),
    statusBar: document.getElementById('statusBar'),
    currentUser: document.getElementById('currentUser'),
    logoutBtn: document.getElementById('logoutBtn'),
    nav: document.getElementById('sidebarNav'),
    modalRoot: document.getElementById('modalRoot'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalCloseBtn: document.getElementById('modalCloseBtn'),
    toastStack: document.getElementById('toastStack'),
    panels: {
      overview: document.getElementById('section-overview'),
      instances: document.getElementById('section-instances'),
      users: document.getElementById('section-users'),
      files: document.getElementById('section-files'),
      permissions: document.getElementById('section-permissions'),
      launcher: document.getElementById('section-launcher'),
      settings: document.getElementById('section-settings')
    }
  };

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function getMultiSelectValues(selectElement) {
    if (!selectElement) return [];
    return Array.from(selectElement.selectedOptions || []).map((option) => option.value).filter(Boolean);
  }

  function parsePermissionInput(value) {
    if (typeof value !== 'string') return [];

    const tokens = value
      .split(/[,\n;]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    const valid = tokens.filter((token) => /^[a-zA-Z0-9.*_-]+$/.test(token));
    return Array.from(new Set(valid));
  }

  function cloneObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return { ...value };
  }

  function permissionMatches(required, rules) {
    const allRules = Array.isArray(rules) ? rules : [];
    return allRules.some((rule) => {
      if (rule === '*' || rule === required) return true;
      if (typeof rule === 'string' && rule.endsWith('.*')) {
        return required.startsWith(rule.slice(0, -1));
      }
      return false;
    });
  }

  function getAdminScopeForUser(userId) {
    if (!userId) return [];
    return state.instances
      .filter((instance) => Array.isArray(instance.admins) && instance.admins.includes(userId))
      .map((instance) => instance.id);
  }

  function renderPermissionBadges(perms, badgeClass = '') {
    const values = Array.isArray(perms) ? perms.filter(Boolean) : [];
    if (!values.length) {
      return '<span class="muted">None</span>';
    }

    const className = badgeClass ? ` ${badgeClass}` : '';
    return values.map((perm) => `<span class="badge${className}">${escapeHtml(perm)}</span>`).join(' ');
  }

  function closeActionMenus() {
    document.querySelectorAll('.action-menu[open]').forEach((detail) => {
      detail.removeAttribute('open');
    });
  }

  function showToast(message, isError = false) {
    if (!els.toastStack || !message) return;

    const toast = document.createElement('div');
    toast.className = `toast${isError ? ' error' : ''}`;
    toast.textContent = message;
    els.toastStack.appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
  }

  function openModal({ title, contentHtml }) {
    if (!els.modalRoot || !els.modalTitle || !els.modalBody) return;

    els.modalTitle.textContent = title || 'Dialog';
    els.modalBody.innerHTML = contentHtml || '';
    els.modalRoot.classList.remove('hidden');
    els.modalRoot.setAttribute('aria-hidden', 'false');

    requestAnimationFrame(() => {
      els.modalRoot.classList.add('open');
    });
  }

  function closeModal() {
    if (!els.modalRoot || !els.modalBody) return;

    els.modalRoot.classList.remove('open');
    els.modalRoot.setAttribute('aria-hidden', 'true');

    setTimeout(() => {
      els.modalRoot.classList.add('hidden');
      els.modalBody.innerHTML = '';
    }, 120);
  }

  function askConfirm({ title, message, confirmText = 'Confirm', danger = false, extraHtml = '' }) {
    return new Promise((resolve) => {
      openModal({
        title,
        contentHtml: `
          <p>${escapeHtml(message)}</p>
          ${extraHtml}
          <div class="modal-actions">
            <button id="modalCancelAction" type="button" class="subtle">Cancel</button>
            <button id="modalConfirmAction" type="button" class="${danger ? 'danger' : 'primary'}">${escapeHtml(confirmText)}</button>
          </div>
        `
      });

      document.getElementById('modalCancelAction')?.addEventListener('click', () => {
        closeModal();
        resolve(false);
      });

      document.getElementById('modalConfirmAction')?.addEventListener('click', () => {
        closeModal();
        resolve(true);
      });
    });
  }

  function status(message, isError = false) {
    if (els.statusBar) {
      els.statusBar.textContent = message;
      els.statusBar.style.color = isError ? '#ffb1b1' : '';
    }

    showToast(message, isError);
  }

  async function api(path, { method = 'GET', body, isForm = false } = {}) {
    const options = {
      method,
      credentials: 'same-origin',
      headers: {}
    };

    if (state.csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      options.headers['X-CSRF-Token'] = state.csrfToken;
    }

    if (body !== undefined) {
      if (isForm) {
        options.body = body;
      } else {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
    }

    const response = await fetch(path, options);
    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = { success: false, error: 'Invalid server response' };
    }

    if (!response.ok || payload.success === false) {
      const error = payload.error || `Request failed (${response.status})`;
      const requestError = new Error(error);
      requestError.status = response.status;
      requestError.payload = payload;
      throw requestError;
    }

    return payload;
  }

  function isForbiddenError(error) {
    return Number(error?.status || 0) === 403;
  }

  function isSectionAvailable(sectionName) {
    return Boolean(els.panels[sectionName]) && state.sectionAccess[sectionName] !== false;
  }

  function getFirstAvailableSection() {
    const orderedSections = ['overview', 'instances', 'files', 'users', 'permissions', 'launcher', 'settings'];
    return orderedSections.find((section) => isSectionAvailable(section)) || 'overview';
  }

  function applySectionAccess() {
    document.querySelectorAll('#sidebarNav button[data-section]').forEach((button) => {
      const sectionName = button.dataset.section;
      const allowed = isSectionAvailable(sectionName);
      button.disabled = !allowed;
      button.hidden = !allowed;
    });
  }

  function switchSection(sectionName) {
    const resolvedSection = isSectionAvailable(sectionName) ? sectionName : getFirstAvailableSection();
    state.activeSection = resolvedSection;

    document.querySelectorAll('#sidebarNav button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.section === resolvedSection);
    });

    Object.entries(els.panels).forEach(([name, panel]) => {
      if (!panel) return;
      panel.classList.toggle('active', name === resolvedSection && isSectionAvailable(name));
    });
  }

  function showAdmin() {
    els.loginView?.classList.add('hidden');
    els.adminView?.classList.remove('hidden');
    if (els.currentUser) {
      els.currentUser.textContent = `${state.user?.username || 'unknown'} (${state.user?.role || 'n/a'})`;
    }
  }

  function showLogin() {
    els.adminView?.classList.add('hidden');
    els.loginView?.classList.remove('hidden');
  }

  function renderOverview() {
    const data = state.overview || {};
    const statusSummary = data.status_summary || {};

    els.panels.overview.innerHTML = `
      <h2>Overview</h2>
      <div class="grid cards">
        <article class="card"><h3>Total Instances</h3><strong>${escapeHtml(data.instances_total ?? 0)}</strong></article>
        <article class="card"><h3>Visible Instances</h3><strong>${escapeHtml(data.instances_visible ?? 0)}</strong></article>
        <article class="card"><h3>Total Users</h3><strong>${escapeHtml(data.users_total ?? 0)}</strong></article>
        <article class="card"><h3>Admin Users</h3><strong>${escapeHtml(data.admins_total ?? 0)}</strong></article>
      </div>
      <div class="grid cards" style="margin-top: 1rem;">
        <article class="card"><h3>Online</h3><strong>${escapeHtml(statusSummary.online ?? 0)}</strong></article>
        <article class="card"><h3>Offline</h3><strong>${escapeHtml(statusSummary.offline ?? 0)}</strong></article>
        <article class="card"><h3>Maintenance</h3><strong>${escapeHtml(statusSummary.maintenance ?? 0)}</strong></article>
        <article class="card"><h3>Unknown</h3><strong>${escapeHtml(statusSummary.unknown ?? 0)}</strong></article>
      </div>
      <div class="card" style="margin-top:1rem;">
        <h3>Storage</h3>
        <p class="muted">Root: ${escapeHtml(data.disk?.root || 'n/a')}</p>
        <p class="muted">Total: ${formatBytes(data.disk?.total_bytes)} | Free: ${formatBytes(data.disk?.free_bytes)}</p>
      </div>
    `;
  }

  function renderInstances() {
    const hasUserDirectory = state.sectionAccess.users !== false && state.users.length > 0;
    const fallbackOwnerId = String(state.user?.id || 'root');
    const fallbackOwnerName = String(state.user?.username || fallbackOwnerId);
    const userOptions = hasUserDirectory
      ? state.users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.username)}</option>`).join('')
      : `<option value="${escapeHtml(fallbackOwnerId)}">${escapeHtml(fallbackOwnerName)}</option>`;

    const rows = state.instances.map((instance) => {
      const admins = Array.isArray(instance.admins) ? instance.admins.join(', ') : '';
      const statusBadgeClass = instance.status === 'online' ? 'good' : (instance.status === 'maintenance' ? 'warn' : '');

      return `
        <tr>
          <td>${escapeHtml(instance.id)}</td>
          <td>${escapeHtml(instance.name)}</td>
          <td>${escapeHtml(instance.owner || 'n/a')}</td>
          <td><span class="badge ${statusBadgeClass}">${escapeHtml(instance.status || 'unknown')}</span></td>
          <td>${escapeHtml(admins)}</td>
          <td><small>${escapeHtml(instance.filesystem_path || '')}</small></td>
          <td class="actions">
            <details class="action-menu">
              <summary>Actions</summary>
              <div class="menu-list">
                <button class="menu-item" data-instance-action="files" data-instance-id="${escapeHtml(instance.id)}">Manage Files</button>
                <button class="menu-item" data-instance-action="edit" data-instance-id="${escapeHtml(instance.id)}">Edit Instance</button>
                <button class="menu-item danger" data-instance-action="delete" data-instance-id="${escapeHtml(instance.id)}">Delete Instance</button>
              </div>
            </details>
          </td>
        </tr>
      `;
    }).join('');

    els.panels.instances.innerHTML = `
      <div class="panel-head">
        <h2>Instances</h2>
        <button id="openCreateInstanceModal" class="primary">Create Instance</button>
      </div>
      <div class="card">
        <p class="muted">Manage metadata, admins, ownership, and open files directly from each instance.</p>
      </div>
      <div class="table-wrap" style="margin-top:1rem;">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Name</th><th>Owner</th><th>Status</th><th>Admins</th><th>Path</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    document.getElementById('openCreateInstanceModal')?.addEventListener('click', () => {
      openModal({
        title: 'Create Instance',
        contentHtml: `
          <form id="createInstanceModalForm" class="form-grid">
            <label>Name <input name="name" required minlength="2" maxlength="64"></label>
            <label>Owner <select name="owner">${userOptions}</select></label>
            <div class="modal-actions" style="grid-column:1/-1;">
              <button type="button" id="cancelCreateInstance" class="subtle">Cancel</button>
              <button type="submit" class="primary">Create Instance</button>
            </div>
          </form>
        `
      });

      document.getElementById('cancelCreateInstance')?.addEventListener('click', closeModal);
      document.getElementById('createInstanceModalForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;

        try {
          await api('api/instances.php', {
            method: 'POST',
            body: {
              name: form.name.value.trim(),
              owner: form.owner.value
            }
          });
          closeModal();
          await refreshData();
          status('Instance created');
        } catch (error) {
          status(error.message, true);
        }
      });
    });

    els.panels.instances.querySelectorAll('[data-instance-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.dataset.instanceAction;
        const instanceId = button.dataset.instanceId;
        const instance = state.instances.find((item) => item.id === instanceId);
        closeActionMenus();
        if (!instance) return;

        if (action === 'files') {
          await openFilesForInstance(instance.id);
          return;
        }

        if (action === 'edit') {
          const selectedAdmins = Array.isArray(instance.admins) ? instance.admins : [];
          const selectedAssignedUsers = hasUserDirectory
            ? state.users
              .filter((user) => Array.isArray(user.instances) && user.instances.includes(instance.id))
              .map((user) => user.id)
            : selectedAdmins.filter((id) => id !== 'root');

          const ownerOptions = hasUserDirectory
            ? state.users.map((user) => {
              const selected = user.id === instance.owner ? 'selected' : '';
              return `<option value="${escapeHtml(user.id)}" ${selected}>${escapeHtml(user.username)}</option>`;
            }).join('')
            : `<option value="${escapeHtml(instance.owner || fallbackOwnerId)}" selected>${escapeHtml(instance.owner || fallbackOwnerName)}</option>`;

          const fallbackUserIds = Array.from(new Set([
            ...(Array.isArray(instance.admins) ? instance.admins : []),
            String(instance.owner || ''),
            'root'
          ].filter(Boolean)));

          const userMultiOptions = hasUserDirectory
            ? state.users.map((user) => {
              const isAdmin = selectedAdmins.includes(user.id) ? 'selected' : '';
              return `<option value="${escapeHtml(user.id)}" ${isAdmin}>${escapeHtml(user.username)} (${escapeHtml(user.id)})</option>`;
            }).join('')
            : fallbackUserIds.map((userId) => {
              const isAdmin = selectedAdmins.includes(userId) ? 'selected' : '';
              return `<option value="${escapeHtml(userId)}" ${isAdmin}>${escapeHtml(userId)}</option>`;
            }).join('');

          const assignedUserOptions = hasUserDirectory
            ? state.users.map((user) => {
              const selected = selectedAssignedUsers.includes(user.id) ? 'selected' : '';
              return `<option value="${escapeHtml(user.id)}" ${selected}>${escapeHtml(user.username)} (${escapeHtml(user.id)})</option>`;
            }).join('')
            : fallbackUserIds.map((userId) => {
              const selected = selectedAssignedUsers.includes(userId) ? 'selected' : '';
              return `<option value="${escapeHtml(userId)}" ${selected}>${escapeHtml(userId)}</option>`;
            }).join('');

          const userDirectoryNotice = hasUserDirectory
            ? ''
            : '<p class="muted">User directory is restricted for your account. You can still edit this instance using known user IDs.</p>';

          const launcherDefaults = {
            loader: {
              minecraft_version: '1.21.1',
              loader_type: 'vanilla',
              loader_version: 'latest'
            },
            verify: true,
            ignored: [],
            whitelist: [],
            whitelistActive: false,
            status: {
              nameServer: instance.name || '',
              ip: '',
              port: 25565
            },
            jvm_args: [],
            game_args: []
          };

          openModal({
            title: `Edit Instance: ${instance.name}`,
            contentHtml: `
              <form id="editInstanceModalForm" class="form-grid">
                <input type="hidden" name="id" value="${escapeHtml(instance.id)}">

                <div class="tab-strip" style="grid-column:1/-1;">
                  <button type="button" class="tab-btn active" data-modal-tab="general">General</button>
                  <button type="button" class="tab-btn" data-modal-tab="launcher">Launcher Settings</button>
                </div>

                <section class="tab-panel active" data-tab-panel="general" style="grid-column:1/-1;">
                  ${userDirectoryNotice}
                  <div class="form-grid" style="margin:0;">
                    <label>Name <input name="name" value="${escapeHtml(instance.name || '')}" required minlength="2" maxlength="64"></label>
                    <label>Owner <select name="owner">${ownerOptions}</select></label>
                    <label>Status
                      <select name="status">
                        <option value="online" ${instance.status === 'online' ? 'selected' : ''}>online</option>
                        <option value="offline" ${instance.status === 'offline' ? 'selected' : ''}>offline</option>
                        <option value="maintenance" ${instance.status === 'maintenance' ? 'selected' : ''}>maintenance</option>
                        <option value="unknown" ${instance.status === 'unknown' ? 'selected' : ''}>unknown</option>
                      </select>
                    </label>
                    <label>Administrators
                      <select name="admins" multiple size="7">${userMultiOptions}</select>
                    </label>
                    <label>Assigned Users
                      <select name="assigned_users" multiple size="7">${assignedUserOptions}</select>
                    </label>
                  </div>
                </section>

                <section class="tab-panel" data-tab-panel="launcher" style="grid-column:1/-1;">
                  <p class="muted">This controls launcher behavior for this instance (loader, verification, excluded files, whitelist, displayed status, and JVM/game args).</p>
                  <p id="launcherSettingsStatus" class="muted">Loading launcher settings...</p>
                  <div class="form-grid" style="margin:0;">
                    <label>Minecraft Version
                      <input name="launcher_mc_version" maxlength="32" placeholder="1.21.1">
                    </label>
                    <label>Loader Type
                      <select name="launcher_loader_type">
                        <option value="vanilla">vanilla</option>
                        <option value="forge">forge</option>
                        <option value="fabric">fabric</option>
                        <option value="quilt">quilt</option>
                        <option value="neoforge">neoforge</option>
                      </select>
                    </label>
                    <label>Loader Version
                      <input name="launcher_loader_version" maxlength="64" placeholder="latest">
                    </label>
                    <label class="checkbox-inline">
                      <input type="checkbox" name="launcher_verify"> Verify downloaded files
                    </label>
                    <label class="checkbox-inline">
                      <input type="checkbox" name="launcher_whitelist_active"> Enforce whitelist in launcher
                    </label>
                    <label>Server Name
                      <input name="launcher_status_name" maxlength="80" placeholder="Instance Name">
                    </label>
                    <label>Server Host/IP
                      <input name="launcher_status_ip" maxlength="255" placeholder="mc.example.com">
                    </label>
                    <label>Server Port
                      <input name="launcher_status_port" type="number" min="1" max="65535" step="1" placeholder="25565">
                    </label>
                    <label style="grid-column:1/-1;">Ignored / Excluded Items (one per line)
                      <textarea name="launcher_ignored" placeholder="logs&#10;screenshots"></textarea>
                    </label>
                    <label style="grid-column:1/-1;">Whitelist Usernames (one per line)
                      <textarea name="launcher_whitelist" placeholder="player_one&#10;player_two"></textarea>
                    </label>
                    <label style="grid-column:1/-1;">JVM Args (one per line)
                      <textarea name="launcher_jvm_args" placeholder="-Xmx4G&#10;-XX:+UseG1GC"></textarea>
                    </label>
                    <label style="grid-column:1/-1;">Game Args (one per line)
                      <textarea name="launcher_game_args" placeholder="--demo"></textarea>
                    </label>
                  </div>
                </section>

                <div class="modal-actions" style="grid-column:1/-1;">
                  <button type="button" id="cancelEditInstance" class="subtle">Cancel</button>
                  <button type="submit" class="primary">Save Changes</button>
                </div>
              </form>
            `
          });

          const parseListField = (value) => String(value || '')
            .split(/\r?\n|,/)
            .map((item) => item.trim())
            .filter(Boolean);

          const setListField = (element, values) => {
            if (!element) return;
            element.value = Array.isArray(values) ? values.join('\n') : '';
          };

          const tabButtons = Array.from(document.querySelectorAll('#editInstanceModalForm [data-modal-tab]'));
          const tabPanels = Array.from(document.querySelectorAll('#editInstanceModalForm [data-tab-panel]'));
          const switchModalTab = (tabName) => {
            tabButtons.forEach((button) => {
              button.classList.toggle('active', button.dataset.modalTab === tabName);
            });
            tabPanels.forEach((panel) => {
              panel.classList.toggle('active', panel.dataset.tabPanel === tabName);
            });
          };

          tabButtons.forEach((button) => {
            button.addEventListener('click', () => {
              switchModalTab(button.dataset.modalTab);
            });
          });

          const launcherStatus = document.getElementById('launcherSettingsStatus');
          const form = document.getElementById('editInstanceModalForm');

          const setLauncherValues = (launcher) => {
            const config = launcher || launcherDefaults;
            const loader = config.loader || launcherDefaults.loader;
            const statusInfo = config.status || launcherDefaults.status;

            form.launcher_mc_version.value = loader.minecraft_version || '';
            form.launcher_loader_type.value = loader.loader_type || 'vanilla';
            form.launcher_loader_version.value = loader.loader_version || '';
            form.launcher_verify.checked = Boolean(config.verify);
            form.launcher_whitelist_active.checked = Boolean(config.whitelistActive);

            form.launcher_status_name.value = statusInfo.nameServer || instance.name || '';
            form.launcher_status_ip.value = statusInfo.ip || '';
            form.launcher_status_port.value = Number(statusInfo.port || 25565);

            setListField(form.launcher_ignored, config.ignored || []);
            setListField(form.launcher_whitelist, config.whitelist || []);
            setListField(form.launcher_jvm_args, config.jvm_args || []);
            setListField(form.launcher_game_args, config.game_args || []);
          };

          setLauncherValues(launcherDefaults);

          (async () => {
            try {
              const result = await api(`api/instance_launcher.php?instance_id=${encodeURIComponent(instance.id)}`);
              setLauncherValues(result.launcher || launcherDefaults);
              if (launcherStatus) {
                launcherStatus.textContent = 'Launcher settings loaded.';
              }
            } catch (error) {
              if (launcherStatus) {
                launcherStatus.textContent = `Could not load launcher settings: ${error.message}`;
              }
            }
          })();

          document.getElementById('cancelEditInstance')?.addEventListener('click', closeModal);
          document.getElementById('editInstanceModalForm')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const submitForm = event.currentTarget;

            const launcherPayload = {
              loader: {
                minecraft_version: submitForm.launcher_mc_version.value.trim(),
                loader_type: submitForm.launcher_loader_type.value,
                loader_version: submitForm.launcher_loader_version.value.trim()
              },
              verify: Boolean(submitForm.launcher_verify.checked),
              ignored: parseListField(submitForm.launcher_ignored.value),
              whitelist: parseListField(submitForm.launcher_whitelist.value),
              whitelistActive: Boolean(submitForm.launcher_whitelist_active.checked),
              status: {
                nameServer: submitForm.launcher_status_name.value.trim(),
                ip: submitForm.launcher_status_ip.value.trim(),
                port: Number(submitForm.launcher_status_port.value || 25565)
              },
              jvm_args: parseListField(submitForm.launcher_jvm_args.value),
              game_args: parseListField(submitForm.launcher_game_args.value)
            };

            const generalPayload = {
              id: submitForm.id.value,
              name: submitForm.name.value.trim(),
              owner: submitForm.owner.value,
              status: submitForm.status.value,
              admins: getMultiSelectValues(submitForm.admins),
              assigned_users: getMultiSelectValues(submitForm.assigned_users)
            };

            let launcherSaved = false;

            try {
              await api('api/instance_launcher.php', {
                method: 'PATCH',
                body: {
                  instance_id: instance.id,
                  launcher: launcherPayload
                }
              });
              launcherSaved = true;

              await api('api/instances.php', {
                method: 'PATCH',
                body: generalPayload
              });

              closeModal();
              await refreshData();
              status('Instance and launcher settings updated');
            } catch (error) {
              if (launcherSaved) {
                status(`Launcher settings saved, but instance update failed: ${error.message}`, true);
              } else {
                status(error.message, true);
              }
            }
          });

          return;
        }
        if (action === 'delete') {
          openModal({
            title: `Delete Instance: ${instance.name}`,
            contentHtml: `
              <form id="deleteInstanceModalForm">
                <p>Delete <strong>${escapeHtml(instance.name)}</strong> (${escapeHtml(instance.id)})?</p>
                <label>
                  <input type="checkbox" name="remove_files"> Also delete instance files from disk
                </label>
                <div class="modal-actions">
                  <button type="button" id="cancelDeleteInstance" class="subtle">Cancel</button>
                  <button type="submit" class="danger">Delete Instance</button>
                </div>
              </form>
            `
          });

          document.getElementById('cancelDeleteInstance')?.addEventListener('click', closeModal);
          document.getElementById('deleteInstanceModalForm')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = event.currentTarget;

            try {
              await api('api/instances.php', {
                method: 'DELETE',
                body: {
                  id: instance.id,
                  remove_files: Boolean(form.remove_files.checked)
                }
              });
              closeModal();
              await refreshData();
              status('Instance deleted');
            } catch (error) {
              status(error.message, true);
            }
          });
        }
      });
    });
  }

  async function openFilesForInstance(instanceId, path = '') {
    state.file.instanceId = instanceId;
    state.file.path = path;
    switchSection('files');
    await loadFiles(instanceId, path);
  }

  function renderUsers() {
    const buildInstanceOptions = (selected = []) => state.instances.map((instance) => {
      const isSelected = selected.includes(instance.id) ? 'selected' : '';
      return `<option value="${escapeHtml(instance.id)}" ${isSelected}>${escapeHtml(instance.name)} (${escapeHtml(instance.id)})</option>`;
    }).join('');

    const roles = Object.keys(state.roles || {});
    const roleOptionsCreate = roles.map((role) => `<option ${role === 'USER' ? 'selected' : ''}>${escapeHtml(role)}</option>`).join('');
    const roleOptionsEdit = (selectedRole) => roles.map((role) => `<option ${selectedRole === role ? 'selected' : ''}>${escapeHtml(role)}</option>`).join('');

    const rows = state.users.map((user) => {
      const protectedBadge = user.protected ? '<span class="badge warn">protected</span>' : '';
      const isEditing = state.userEditorId === user.id ? '<span class="badge good">editing</span>' : '';
      return `
        <tr>
          <td>${escapeHtml(user.id)}</td>
          <td>${escapeHtml(user.username)} ${protectedBadge} ${isEditing}</td>
          <td>${escapeHtml(user.email || '')}</td>
          <td>${escapeHtml(user.role || '')}</td>
          <td>${escapeHtml((user.instances || []).join(', '))}</td>
          <td class="actions">
            <button data-edit-user="${escapeHtml(user.id)}" ${user.protected ? 'disabled' : ''}>Open editor</button>
            <button data-delete-user="${escapeHtml(user.id)}" class="danger" ${user.protected ? 'disabled' : ''}>Delete</button>
          </td>
        </tr>
      `;
    }).join('');

    const editingUser = state.users.find((user) => user.id === state.userEditorId && !user.protected) || null;
    const editingUserAssigned = Array.isArray(editingUser?.instances) ? editingUser.instances : [];
    const editingUserAdminScope = editingUser ? getAdminScopeForUser(editingUser.id) : [];

    els.panels.users.innerHTML = `
      <h2>Users</h2>
      <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 1rem;">
        <div class="card">
          <h3>Create User</h3>
          <p class="muted">Create user, assign instances, and optionally grant instance-admin scope.</p>
          <form id="createUserForm" class="form-grid">
            <label>Username <input name="username" required minlength="3" maxlength="32"></label>
            <label>Email <input name="email" type="email" required></label>
            <label>Password <input name="password" type="password" required minlength="8"></label>
            <label>Role
              <select name="role">
                ${roleOptionsCreate}
              </select>
            </label>
            <label>Assigned Instances
              <select name="instances" multiple size="6">
                ${buildInstanceOptions([])}
              </select>
            </label>
            <label>Admin Access to Instances
              <select name="admin_instance_ids" multiple size="6">
                ${buildInstanceOptions([])}
              </select>
            </label>
            <button type="submit">Create User</button>
          </form>
        </div>

        <div class="card" id="userEditorCard">
          <h3>User Editor</h3>
          <p class="muted">${editingUser ? `Editing ${escapeHtml(editingUser.username)} (${escapeHtml(editingUser.id)})` : 'Select a user from the table to edit.'}</p>
          <form id="editUserForm" class="form-grid">
            <input type="hidden" name="id" value="${escapeHtml(editingUser?.id || '')}">
            <label>Email <input name="email" type="email" value="${escapeHtml(editingUser?.email || '')}" ${editingUser ? '' : 'disabled'}></label>
            <label>Role
              <select name="role" ${editingUser ? '' : 'disabled'}>
                ${roleOptionsEdit(editingUser?.role || 'USER')}
              </select>
            </label>
            <label>New Password (optional)
              <input name="password" type="password" minlength="8" placeholder="Leave blank to keep current" ${editingUser ? '' : 'disabled'}>
            </label>
            <label>Assigned Instances
              <select name="instances" multiple size="6" ${editingUser ? '' : 'disabled'}>
                ${buildInstanceOptions(editingUserAssigned)}
              </select>
            </label>
            <label>Admin Access to Instances
              <select name="admin_instance_ids" multiple size="6" ${editingUser ? '' : 'disabled'}>
                ${buildInstanceOptions(editingUserAdminScope)}
              </select>
            </label>
            <div class="toolbar" style="grid-column: 1 / -1;">
              <button type="submit" ${editingUser ? '' : 'disabled'}>Save changes</button>
              <button type="button" id="cancelUserEditBtn" ${editingUser ? '' : 'disabled'}>Close editor</button>
            </div>
          </form>
        </div>
      </div>

      <div class="table-wrap" style="margin-top:1rem;">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Username</th><th>Email</th><th>Role</th><th>Instances</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    document.getElementById('createUserForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const instances = getMultiSelectValues(form.instances);
      const adminInstanceIds = getMultiSelectValues(form.admin_instance_ids);

      const payload = {
        username: form.username.value.trim(),
        email: form.email.value.trim(),
        password: form.password.value,
        role: form.role.value,
        instances,
        admin_instance_ids: adminInstanceIds
      };

      try {
        await api('api/users.php', { method: 'POST', body: payload });
        await refreshData();
        status('User created');
      } catch (error) {
        status(error.message, true);
      }
    });

    document.getElementById('editUserForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.id.value) return;

      const instances = getMultiSelectValues(form.instances);
      const adminInstanceIds = getMultiSelectValues(form.admin_instance_ids);

      const payload = {
        id: form.id.value,
        email: form.email.value.trim(),
        role: form.role.value,
        instances,
        admin_instance_ids: adminInstanceIds
      };

      if (form.password.value.trim()) {
        payload.password = form.password.value;
      }

      try {
        await api('api/users.php', {
          method: 'PATCH',
          body: payload
        });
        state.userEditorId = form.id.value;
        await refreshData();
        status('User updated');
      } catch (error) {
        status(error.message, true);
      }
    });

    document.getElementById('cancelUserEditBtn')?.addEventListener('click', () => {
      state.userEditorId = null;
      renderUsers();
    });

    els.panels.users.querySelectorAll('[data-edit-user]').forEach((button) => {
      button.addEventListener('click', () => {
        state.userEditorId = button.dataset.editUser;
        renderUsers();
      });
    });

    els.panels.users.querySelectorAll('[data-delete-user]').forEach((button) => {
      button.addEventListener('click', async () => {
        const userId = button.dataset.deleteUser;
        const confirmed = await askConfirm({
          title: 'Delete User',
          message: `Delete user ${userId}?`,
          confirmText: 'Delete User',
          danger: true
        });

        if (!confirmed) return;

        try {
          await api('api/users.php', { method: 'DELETE', body: { id: userId } });
          closeModal();
          if (state.userEditorId === userId) {
            state.userEditorId = null;
          }
          await refreshData();
          status('User deleted');
        } catch (error) {
          status(error.message, true);
        }
      });
    });
  }

  function renderFiles() {
    const options = state.instances.map((instance) => `<option value="${escapeHtml(instance.id)}">${escapeHtml(instance.name)}</option>`).join('');
    const isReadOnly = !state.file.writable;
    const activeInstance = state.instances.find((instance) => instance.id === state.file.instanceId);

    const getParentPath = (path) => {
      const parts = String(path || '').split('/').filter(Boolean);
      parts.pop();
      return parts.join('/');
    };

    const visiblePaths = (state.file.items || [])
      .map((item) => String(item.path || '').trim())
      .filter(Boolean);
    const visiblePathSet = new Set(visiblePaths);

    const selectedPaths = Array.isArray(state.file.selectedPaths)
      ? state.file.selectedPaths.filter((path) => visiblePathSet.has(path))
      : [];
    state.file.selectedPaths = Array.from(new Set(selectedPaths));
    const selectedPathSet = new Set(state.file.selectedPaths);

    const selectedCount = state.file.selectedPaths.length;
    const allVisibleSelected = visiblePaths.length > 0 && selectedCount === visiblePaths.length;

    const rows = (state.file.items || []).map((item) => {
      const itemPath = String(item.path || '');
      const canExtract = item.type === 'file' && /\.zip$/i.test(String(item.name || ''));
      const modifiedAt = item.modified_at ? new Date(item.modified_at).toLocaleString() : '-';

      return `
        <tr>
          <td class="file-select-cell">
            <input type="checkbox" data-select-path="${escapeHtml(itemPath)}" ${selectedPathSet.has(itemPath) ? 'checked' : ''}>
          </td>
          <td>${escapeHtml(item.type)}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.path)}</td>
          <td>${item.size != null ? escapeHtml(item.size) : '-'}</td>
          <td>${escapeHtml(modifiedAt)}</td>
          <td class="actions">
            ${item.type === 'directory' ? `<button data-open-dir="${escapeHtml(item.path)}">Open</button>` : `<button data-open-file="${escapeHtml(item.path)}">Edit</button>`}
            ${canExtract ? `<button data-extract-path="${escapeHtml(item.path)}" ${isReadOnly ? 'disabled' : ''}>Extract</button>` : ''}
            <button class="danger" data-delete-path="${escapeHtml(item.path)}" ${isReadOnly ? 'disabled' : ''}>Delete</button>
          </td>
        </tr>
      `;
    }).join('');

    els.panels.files.innerHTML = `
      <div class="panel-head">
        <h2>File Management</h2>
        <div class="toolbar" style="margin:0;">
          <span class="badge">Instance: ${escapeHtml(activeInstance?.name || 'none')}</span>
          <button id="goInstancesBtn" class="subtle">Back to Instances</button>
        </div>
      </div>
      <div class="card">
        <div class="toolbar">
          <span class="badge ${state.file.writable ? 'good' : 'warn'}">${state.file.writable ? 'Current folder writable' : 'Current folder read-only'}</span>
          <label>Instance
            <select id="fileInstanceSelect">${options}</select>
          </label>
          <label>Path
            <input id="filePathInput" placeholder="config" value="${escapeHtml(state.file.path || '')}">
          </label>
          <button id="fileLoadBtn">Load</button>
          <button id="fileUpBtn" class="subtle">Up</button>
          <button id="fileRefreshBtn" class="subtle">Refresh</button>
        </div>
        <p class="muted">Supports single/multi-file upload, folder upload, and zip extraction inside the instance directory only.</p>
        <div class="toolbar">
          <input type="text" id="mkdirInput" placeholder="new-folder" ${isReadOnly ? 'disabled' : ''}>
          <button id="mkdirBtn" ${isReadOnly ? 'disabled' : ''}>Create Folder</button>
        </div>
        <div class="toolbar">
          <input type="file" id="uploadInput" multiple ${isReadOnly ? 'disabled' : ''}>
          <button id="uploadBtn" ${isReadOnly ? 'disabled' : ''}>Upload File(s)</button>
          <input type="file" id="folderUploadInput" webkitdirectory directory multiple ${isReadOnly ? 'disabled' : ''}>
          <button id="uploadFolderBtn" ${isReadOnly ? 'disabled' : ''}>Upload Folder</button>
        </div>
        <div class="toolbar">
          <input type="text" id="extractPathInput" placeholder="archive.zip" ${isReadOnly ? 'disabled' : ''}>
          <button id="extractBtn" ${isReadOnly ? 'disabled' : ''}>Extract Zip</button>
        </div>
      </div>

      <div class="toolbar" style="margin-top:1rem;">
        <label class="checkbox-inline" style="margin:0;">
          <input type="checkbox" id="fileSelectAll" ${allVisibleSelected ? 'checked' : ''} ${visiblePaths.length === 0 ? 'disabled' : ''}>
          Select all (${visiblePaths.length})
        </label>
        <button id="fileClearSelectionBtn" class="subtle" ${selectedCount === 0 ? 'disabled' : ''}>Clear Selection</button>
        <button id="fileDeleteSelectedBtn" class="danger" ${isReadOnly || selectedCount === 0 ? 'disabled' : ''}>Delete Selected (${selectedCount})</button>
      </div>

      <div class="table-wrap" style="margin-top:0.5rem;">
        <table>
          <thead><tr><th style="width:44px;">Sel</th><th>Type</th><th>Name</th><th>Path</th><th>Size</th><th>Modified</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="muted">Directory is empty.</td></tr>'}</tbody>
        </table>
      </div>

      <div class="card" style="margin-top:1rem;">
        <h3>Editor</h3>
        <p class="muted">File: <span id="editorPath">${escapeHtml(state.file.selectedFile || 'none')}</span></p>
        <textarea id="fileEditor">${escapeHtml(state.file.content || '')}</textarea>
        <button id="saveFileBtn" class="primary" style="margin-top:0.6rem;" ${isReadOnly ? 'disabled' : ''}>Save File</button>
      </div>
    `;

    const instanceSelect = document.getElementById('fileInstanceSelect');
    instanceSelect.value = state.file.instanceId || state.instances[0]?.id || '';
    state.file.instanceId = instanceSelect.value;

    const uploadFiles = async (files, successLabel) => {
      if (!files || files.length === 0) {
        status('No files selected', true);
        return;
      }

      const formData = new FormData();
      formData.append('path', state.file.path || '');
      Array.from(files).forEach((file) => {
        const relativeName = String(file.webkitRelativePath || file.name || '');
        formData.append('relative_paths[]', relativeName);
        formData.append('files[]', file, file.name);
      });

      try {
        const result = await api(`api/files.php?instance_id=${encodeURIComponent(state.file.instanceId)}&action=upload`, {
          method: 'POST',
          body: formData,
          isForm: true
        });
        await loadFiles(state.file.instanceId, state.file.path);
        status(`${successLabel} (${result.uploaded || files.length} file(s))`);
      } catch (error) {
        status(error.message, true);
      }
    };

    const extractArchive = async (archivePath) => {
      const safePath = String(archivePath || '').trim();
      if (!safePath) {
        status('Archive path is required', true);
        return;
      }

      try {
        const result = await api(`api/files.php?instance_id=${encodeURIComponent(state.file.instanceId)}&action=extract`, {
          method: 'POST',
          body: {
            path: safePath,
            destination: state.file.path || ''
          }
        });
        await loadFiles(state.file.instanceId, state.file.path);
        status(`Extracted ${result.extracted || 0} file(s)`);
      } catch (error) {
        status(error.message, true);
      }
    };

    document.getElementById('goInstancesBtn')?.addEventListener('click', () => {
      switchSection('instances');
    });

    document.getElementById('fileLoadBtn')?.addEventListener('click', async () => {
      state.file.instanceId = instanceSelect.value;
      state.file.path = document.getElementById('filePathInput').value.trim();
      await loadFiles(state.file.instanceId, state.file.path);
    });

    document.getElementById('fileUpBtn')?.addEventListener('click', async () => {
      state.file.path = getParentPath(state.file.path || '');
      document.getElementById('filePathInput').value = state.file.path;
      await loadFiles(state.file.instanceId, state.file.path);
    });

    document.getElementById('fileRefreshBtn')?.addEventListener('click', async () => {
      await loadFiles(state.file.instanceId, state.file.path);
    });

    document.getElementById('mkdirBtn')?.addEventListener('click', async () => {
      const folderName = document.getElementById('mkdirInput').value.trim();
      if (!folderName) return;
      const path = [state.file.path, folderName].filter(Boolean).join('/');

      try {
        await api(`api/files.php?instance_id=${encodeURIComponent(state.file.instanceId)}&action=mkdir`, {
          method: 'POST',
          body: { path }
        });
        await loadFiles(state.file.instanceId, state.file.path);
        status('Folder created');
      } catch (error) {
        status(error.message, true);
      }
    });

    document.getElementById('uploadBtn')?.addEventListener('click', async () => {
      const uploadInput = document.getElementById('uploadInput');
      await uploadFiles(uploadInput.files, 'Upload complete');
      uploadInput.value = '';
    });

    document.getElementById('uploadFolderBtn')?.addEventListener('click', async () => {
      const folderUploadInput = document.getElementById('folderUploadInput');
      await uploadFiles(folderUploadInput.files, 'Folder upload complete');
      folderUploadInput.value = '';
    });

    document.getElementById('extractBtn')?.addEventListener('click', async () => {
      const archivePath = document.getElementById('extractPathInput').value;
      await extractArchive(archivePath);
    });

    document.getElementById('saveFileBtn')?.addEventListener('click', async () => {
      if (!state.file.selectedFile) {
        status('No selected file', true);
        return;
      }

      const content = document.getElementById('fileEditor').value;

      try {
        await api(`api/files.php?instance_id=${encodeURIComponent(state.file.instanceId)}&action=write`, {
          method: 'POST',
          body: { path: state.file.selectedFile, content }
        });
        status('File saved');
      } catch (error) {
        status(error.message, true);
      }
    });

    document.getElementById('fileSelectAll')?.addEventListener('change', (event) => {
      if (event.currentTarget.checked) {
        state.file.selectedPaths = [...visiblePaths];
      } else {
        state.file.selectedPaths = [];
      }
      renderFiles();
    });

    document.getElementById('fileClearSelectionBtn')?.addEventListener('click', () => {
      state.file.selectedPaths = [];
      renderFiles();
    });

    document.getElementById('fileDeleteSelectedBtn')?.addEventListener('click', async () => {
      const targets = Array.isArray(state.file.selectedPaths)
        ? state.file.selectedPaths.filter(Boolean)
        : [];

      if (targets.length === 0) {
        status('No paths selected', true);
        return;
      }

      const preview = targets.slice(0, 3).join(', ');
      const suffix = targets.length > 3 ? ` and ${targets.length - 3} more` : '';
      const confirmed = await askConfirm({
        title: 'Delete Selected Paths',
        message: `Delete ${targets.length} selected path(s)? ${preview}${suffix}`,
        confirmText: 'Delete Selected',
        danger: true
      });

      if (!confirmed) return;

      try {
        const result = await api(`api/files.php?instance_id=${encodeURIComponent(state.file.instanceId)}&action=delete`, {
          method: 'DELETE',
          body: { paths: targets }
        });
        closeModal();
        state.file.selectedPaths = [];
        await loadFiles(state.file.instanceId, state.file.path);
        status(`${result.deleted || targets.length} path(s) deleted`);
      } catch (error) {
        status(error.message, true);
      }
    });

    els.panels.files.querySelectorAll('[data-select-path]').forEach((input) => {
      input.addEventListener('change', (event) => {
        const path = String(event.currentTarget.dataset.selectPath || '');
        if (!path) {
          return;
        }

        const set = new Set(Array.isArray(state.file.selectedPaths) ? state.file.selectedPaths : []);
        if (event.currentTarget.checked) {
          set.add(path);
        } else {
          set.delete(path);
        }

        state.file.selectedPaths = Array.from(set);
        renderFiles();
      });
    });

    els.panels.files.querySelectorAll('[data-open-dir]').forEach((button) => {
      button.addEventListener('click', async () => {
        const path = button.dataset.openDir;
        state.file.path = path;
        document.getElementById('filePathInput').value = path;
        await loadFiles(state.file.instanceId, path);
      });
    });

    els.panels.files.querySelectorAll('[data-open-file]').forEach((button) => {
      button.addEventListener('click', async () => {
        const path = button.dataset.openFile;
        try {
          const result = await api(`api/files.php?instance_id=${encodeURIComponent(state.file.instanceId)}&action=read&path=${encodeURIComponent(path)}`);
          state.file.selectedFile = result.path;
          state.file.content = result.content;
          renderFiles();
        } catch (error) {
          status(error.message, true);
        }
      });
    });

    els.panels.files.querySelectorAll('[data-extract-path]').forEach((button) => {
      button.addEventListener('click', async () => {
        const archivePath = button.dataset.extractPath;
        await extractArchive(archivePath);
      });
    });

    els.panels.files.querySelectorAll('[data-delete-path]').forEach((button) => {
      button.addEventListener('click', async () => {
        const path = button.dataset.deletePath;
        const confirmed = await askConfirm({
          title: 'Delete Path',
          message: `Delete ${path}?`,
          confirmText: 'Delete',
          danger: true
        });

        if (!confirmed) return;

        try {
          await api(`api/files.php?instance_id=${encodeURIComponent(state.file.instanceId)}&action=delete`, {
            method: 'DELETE',
            body: { path }
          });
          closeModal();
          state.file.selectedPaths = Array.isArray(state.file.selectedPaths)
            ? state.file.selectedPaths.filter((entry) => entry !== path)
            : [];
          await loadFiles(state.file.instanceId, state.file.path);
          status('Path deleted');
        } catch (error) {
          status(error.message, true);
        }
      });
    });
  }
  function renderPermissions() {
    if (state.sectionAccess.permissions === false) {
      els.panels.permissions.innerHTML = '<h2>Permissions / Roles</h2><div class="card"><p class="muted">This section is restricted to global administrators.</p></div>';
      return;
    }

    const roleNames = Object.keys(state.roles || {});
    const rolesMeta = state.rolesMeta || {};
    const allPermissions = state.permissions || [];

    const matrixHeader = roleNames.map((role) => `<th>${escapeHtml(role)}</th>`).join('');
    const matrixRows = allPermissions.map((permission) => {
      const columns = roleNames.map((role) => {
        const allowed = permissionMatches(permission, state.roles?.[role] || []);
        return `<td>${allowed ? '<span class="badge good">allow</span>' : '<span class="badge warn">deny</span>'}</td>`;
      }).join('');
      return `<tr><td>${escapeHtml(permission)}</td>${columns}</tr>`;
    }).join('');

    const roleRows = roleNames.map((role) => {
      const meta = rolesMeta[role] || {};
      const permissions = Array.isArray(meta.permissions) ? meta.permissions : (state.roles?.[role] || []);
      const badges = renderPermissionBadges(permissions);
      const builtinBadge = meta.builtin ? '<span class="badge">built-in</span>' : '<span class="badge good">custom</span>';

      return `
        <tr>
          <td>${escapeHtml(role)} ${builtinBadge}</td>
          <td>${badges}</td>
          <td class="actions">
            <button data-role-edit="${escapeHtml(role)}" ${meta.editable === false ? 'disabled' : ''}>Edit</button>
            <button data-role-delete="${escapeHtml(role)}" class="danger" ${meta.deletable ? '' : 'disabled'}>Delete</button>
          </td>
        </tr>
      `;
    }).join('');

    const userOptions = state.users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.username)} (${escapeHtml(user.role)})</option>`).join('');
    const instanceOnlyOptions = state.instances.map((instance) => `<option value="${escapeHtml(instance.id)}">${escapeHtml(instance.name)}</option>`).join('');
    const instanceOptions = `<option value="">Global context</option>` + instanceOnlyOptions;

    els.panels.permissions.innerHTML = `
      <h2>Permissions / Roles</h2>

      <div class="card">
        <div class="panel-head" style="margin-bottom:0.6rem;">
          <h3 style="margin:0;">Role Manager</h3>
          <button id="createRoleBtn" class="primary">Create Role</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Role</th><th>Permissions</th><th>Actions</th></tr>
            </thead>
            <tbody>${roleRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card" style="margin-top:1rem;">
        <h3>Role Permission Matrix</h3>
        <p class="muted">This matrix shows role defaults. Use inspector and editor below for real user permissions.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Permission</th>${matrixHeader}</tr>
            </thead>
            <tbody>${matrixRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card" style="margin-top:1rem;">
        <h3>Effective Permission Inspector</h3>
        <p class="muted">Pick a user and optional instance to see exactly where permissions come from.</p>
        <form id="permissionEvalForm" class="form-grid">
          <label>User <select name="user_id">${userOptions}</select></label>
          <label>Context <select name="instance_id">${instanceOptions}</select></label>
          <button type="submit">Inspect Permissions</button>
        </form>
        <div id="permissionEvalResult" class="grid cards"></div>
      </div>

      <div class="card" style="margin-top:1rem;">
        <h3>Quick Grant: Full Instance Power</h3>
        <p class="muted">Granting this sets instance-scoped permissions to <code>*</code> for one instance only. It does not grant global user, role, settings, or launcher administration.</p>
        <form id="quickInstancePowerForm" class="form-grid">
          <label>User <select name="user_id">${userOptions}</select></label>
          <label>Instance <select name="instance_id">${instanceOnlyOptions}</select></label>
          <div class="modal-actions" style="grid-column:1/-1; margin-top:0; justify-content:flex-start;">
            <button type="submit" class="primary" ${!userOptions || !instanceOnlyOptions ? 'disabled' : ''}>Grant Full Instance Power</button>
          </div>
        </form>
      </div>

      <div class="card" style="margin-top:1rem;">
        <h3>Permission Editor</h3>
        <p class="muted">Edit user-level custom permissions and optional per-instance override rules.</p>
        <form id="permissionEditorForm" class="form-grid">
          <label>User
            <select name="user_id">${userOptions}</select>
          </label>
          <label>Instance Override Target
            <select name="instance_id">${instanceOptions}</select>
          </label>
          <label style="grid-column:1/-1;">User Custom Permissions (one per line or comma-separated)
            <textarea name="custom_permissions" placeholder="files.read&#10;files.write"></textarea>
          </label>
          <label style="grid-column:1/-1;">Instance Override Permissions
            <textarea name="instance_permissions" placeholder="instance.manage&#10;files.read"></textarea>
          </label>
          <div class="modal-actions" style="grid-column:1/-1; margin-top:0; justify-content:flex-start;">
            <button type="button" id="permissionEditorReloadBtn" class="subtle">Load Current Values</button>
            <button type="submit" id="permissionEditorSaveBtn" class="primary">Save Permission Overrides</button>
          </div>
        </form>
        <div id="permissionEditorPreview" class="grid cards" style="margin-top:0.5rem;"></div>
      </div>
    `;

    const openRoleEditorModal = (mode, roleName = '', initialPermissions = []) => {
      const isCreate = mode === 'create';

      openModal({
        title: isCreate ? 'Create Role' : `Edit Role: ${roleName}`,
        contentHtml: `
          <form id="roleEditorForm" class="form-grid">
            <label>Role Name
              <input name="role" value="${escapeHtml(roleName)}" ${isCreate ? '' : 'readonly'} placeholder="MY_CUSTOM_ROLE" required>
            </label>
            <label style="grid-column:1/-1;">Permissions (one per line or comma-separated)
              <textarea name="permissions">${escapeHtml((initialPermissions || []).join('\n'))}</textarea>
            </label>
            <div class="modal-actions" style="grid-column:1/-1;">
              <button type="button" id="cancelRoleEditor" class="subtle">Cancel</button>
              <button type="submit" class="primary">${isCreate ? 'Create Role' : 'Save Role'}</button>
            </div>
          </form>
        `
      });

      document.getElementById('cancelRoleEditor')?.addEventListener('click', closeModal);
      document.getElementById('roleEditorForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const role = String(form.role.value || '').trim().toUpperCase();
        const permissions = parsePermissionInput(form.permissions.value);

        try {
          await api('api/permissions.php', {
            method: isCreate ? 'POST' : 'PATCH',
            body: {
              action: isCreate ? 'role.create' : 'role.update',
              role,
              permissions
            }
          });
          closeModal();
          await refreshData();
          switchSection('permissions');
          status(isCreate ? 'Role created' : 'Role updated');
        } catch (error) {
          status(error.message, true);
        }
      });
    };

    document.getElementById('createRoleBtn')?.addEventListener('click', () => {
      openRoleEditorModal('create', '', []);
    });

    els.panels.permissions.querySelectorAll('[data-role-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        const role = button.dataset.roleEdit;
        const rolePermissions = state.roles?.[role] || [];
        openRoleEditorModal('edit', role, rolePermissions);
      });
    });

    els.panels.permissions.querySelectorAll('[data-role-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const role = button.dataset.roleDelete;
        if (!role) return;

        const confirmed = await askConfirm({
          title: 'Delete Role',
          message: `Delete role ${role}? Users with this role will be set to USER.`,
          confirmText: 'Delete Role',
          danger: true
        });

        if (!confirmed) return;

        try {
          await api('api/permissions.php', {
            method: 'DELETE',
            body: {
              action: 'role.delete',
              role
            }
          });
          await refreshData();
          switchSection('permissions');
          status('Role deleted');
        } catch (error) {
          status(error.message, true);
        }
      });
    });

    document.getElementById('permissionEvalForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = {
        user_id: form.user_id.value,
        instance_id: form.instance_id.value,
        action: 'inspect'
      };

      try {
        const result = await api('api/permissions.php', { method: 'POST', body: payload });
        const effective = result.effective_permissions || [];

        const granted = allPermissions.filter((perm) => permissionMatches(perm, effective));
        const denied = allPermissions.filter((perm) => !permissionMatches(perm, effective));

        document.getElementById('permissionEvalResult').innerHTML = `
          <article class="card">
            <h3>Identity</h3>
            <p class="muted">Role: ${escapeHtml(result.role || 'USER')}</p>
            <p class="muted">Context: ${escapeHtml(result.instance_id || 'global')}</p>
          </article>
          <article class="card">
            <h3>Role Defaults</h3>
            <p>${renderPermissionBadges(result.role_permissions || [])}</p>
          </article>
          <article class="card">
            <h3>User Overrides</h3>
            <p>${renderPermissionBadges(result.custom_permissions || [])}</p>
          </article>
          <article class="card">
            <h3>Instance Overrides</h3>
            <p>${renderPermissionBadges(result.instance_permissions || [])}</p>
          </article>
          <article class="card">
            <h3>Resolved Rules</h3>
            <p>${renderPermissionBadges(effective)}</p>
          </article>
          <article class="card">
            <h3>Granted Permissions</h3>
            <p>${renderPermissionBadges(granted, 'good')}</p>
          </article>
          <article class="card">
            <h3>Denied Permissions</h3>
            <p>${renderPermissionBadges(denied, 'warn')}</p>
          </article>
        `;
      } catch (error) {
        document.getElementById('permissionEvalResult').innerHTML = `<article class="card"><h3>Error</h3><p class="muted">${escapeHtml(error.message)}</p></article>`;
      }
    });

    document.getElementById('quickInstancePowerForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const userId = String(form.user_id?.value || '');
      const instanceId = String(form.instance_id?.value || '');

      if (!userId || !instanceId) {
        status('User and instance are required for quick grant', true);
        return;
      }

      const selectedUser = state.users.find((user) => user.id === userId);
      if (!selectedUser) {
        status('Selected user not found', true);
        return;
      }

      if (selectedUser.id === 'root' || selectedUser.username === 'root' || selectedUser.protected) {
        status('Root account permissions cannot be modified', true);
        return;
      }

      const instancePermissionsMap = cloneObject(selectedUser.instance_permissions);
      instancePermissionsMap[instanceId] = ['*'];

      const assignedInstances = Array.isArray(selectedUser.instances) ? [...selectedUser.instances] : [];
      if (!assignedInstances.includes(instanceId)) {
        assignedInstances.push(instanceId);
      }

      const adminScope = getAdminScopeForUser(userId);
      if (!adminScope.includes(instanceId)) {
        adminScope.push(instanceId);
      }

      try {
        await api('api/users.php', {
          method: 'PATCH',
          body: {
            id: userId,
            instances: assignedInstances,
            admin_instance_ids: adminScope,
            instance_permissions: instancePermissionsMap
          }
        });

        await refreshData();
        switchSection('permissions');
        status('Full instance power granted for selected instance');
      } catch (error) {
        status(error.message, true);
      }
    });

    const permissionEditorForm = document.getElementById('permissionEditorForm');
    const editorUserSelect = permissionEditorForm?.querySelector('select[name="user_id"]');
    const editorInstanceSelect = permissionEditorForm?.querySelector('select[name="instance_id"]');
    const editorCustomInput = permissionEditorForm?.querySelector('textarea[name="custom_permissions"]');
    const editorInstanceInput = permissionEditorForm?.querySelector('textarea[name="instance_permissions"]');
    const editorSaveBtn = document.getElementById('permissionEditorSaveBtn');
    const editorPreview = document.getElementById('permissionEditorPreview');

    const loadEditorValues = async () => {
      if (!editorUserSelect || !editorCustomInput || !editorInstanceInput || !editorPreview || !editorSaveBtn) {
        return;
      }

      const userId = editorUserSelect.value;
      const instanceId = editorInstanceSelect?.value || '';
      const selectedUser = state.users.find((user) => user.id === userId);
      const isProtected = Boolean(selectedUser?.protected) || selectedUser?.id === 'root' || selectedUser?.username === 'root';

      try {
        const result = await api('api/permissions.php', {
          method: 'POST',
          body: {
            action: 'inspect',
            user_id: userId,
            instance_id: instanceId
          }
        });

        editorCustomInput.value = (result.custom_permissions || []).join('\n');
        editorInstanceInput.value = (result.instance_permissions || []).join('\n');
        editorInstanceInput.disabled = !instanceId || isProtected;

        editorSaveBtn.disabled = isProtected;
        editorSaveBtn.textContent = isProtected ? 'Root account is immutable' : 'Save Permission Overrides';

        editorPreview.innerHTML = `
          <article class="card">
            <h3>Role Defaults</h3>
            <p>${renderPermissionBadges(result.role_permissions || [])}</p>
          </article>
          <article class="card">
            <h3>User Custom</h3>
            <p>${renderPermissionBadges(result.custom_permissions || [])}</p>
          </article>
          <article class="card">
            <h3>Instance Custom</h3>
            <p>${renderPermissionBadges(result.instance_permissions || [])}</p>
          </article>
        `;
      } catch (error) {
        editorPreview.innerHTML = `<article class="card"><h3>Error</h3><p class="muted">${escapeHtml(error.message)}</p></article>`;
      }
    };

    document.getElementById('permissionEditorReloadBtn')?.addEventListener('click', loadEditorValues);
    editorUserSelect?.addEventListener('change', loadEditorValues);
    editorInstanceSelect?.addEventListener('change', loadEditorValues);

    permissionEditorForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!editorUserSelect || !editorCustomInput || !editorInstanceInput) return;

      const userId = editorUserSelect.value;
      const instanceId = editorInstanceSelect?.value || '';
      const selectedUser = state.users.find((user) => user.id === userId);

      if (!selectedUser) {
        status('Selected user not found', true);
        return;
      }

      if (selectedUser.id === 'root' || selectedUser.username === 'root' || selectedUser.protected) {
        status('Root account permissions cannot be modified', true);
        return;
      }

      const globalPermissions = parsePermissionInput(editorCustomInput.value);
      const instancePermissionsMap = cloneObject(selectedUser.instance_permissions);

      if (instanceId) {
        const instancePermissions = parsePermissionInput(editorInstanceInput.value);
        if (instancePermissions.length > 0) {
          instancePermissionsMap[instanceId] = instancePermissions;
        } else {
          delete instancePermissionsMap[instanceId];
        }
      }

      try {
        await api('api/users.php', {
          method: 'PATCH',
          body: {
            id: userId,
            instances: Array.isArray(selectedUser.instances) ? selectedUser.instances : [],
            admin_instance_ids: getAdminScopeForUser(userId),
            permissions: globalPermissions,
            instance_permissions: instancePermissionsMap
          }
        });

        await refreshData();
        switchSection('permissions');
        status('Permission overrides updated');
      } catch (error) {
        status(error.message, true);
      }
    });

    loadEditorValues();
  }

  function renderLauncher() {
    const launcherPanel = els.panels.launcher;
    if (!launcherPanel) {
      return;
    }

    const config = state.launcher?.config || {};
    const news = Array.isArray(state.launcher?.news) ? state.launcher.news : [];

    const toDatetimeLocal = (value) => {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };

    const newsRows = news.map((item, index) => {
      return `
        <tr>
          <td>${escapeHtml(item.title || '')}</td>
          <td>${escapeHtml(item.author || '')}</td>
          <td>${escapeHtml(item.publish_date || '')}</td>
          <td class="actions">
            <details class="action-menu">
              <summary>Actions</summary>
              <div class="menu-list">
                <button class="menu-item" data-news-action="edit" data-news-index="${index}">Edit News</button>
                <button class="menu-item danger" data-news-action="delete" data-news-index="${index}">Delete News</button>
              </div>
            </details>
          </td>
        </tr>
      `;
    }).join('');

    launcherPanel.innerHTML = `
      <div class="panel-head">
        <h2>Launcher Content</h2>
        <button id="refreshLauncherBtn" class="subtle">Reload</button>
      </div>

      <div class="card">
        <h3>Launcher Configuration</h3>
        <form id="launcherConfigForm" class="form-grid">
          <label>Maintenance Mode
            <select name="maintenance">
              <option value="false" ${config.maintenance ? '' : 'selected'}>Disabled</option>
              <option value="true" ${config.maintenance ? 'selected' : ''}>Enabled</option>
            </select>
          </label>
          <label>Online Endpoint
            <input name="online" value="${escapeHtml(config.online || '')}" maxlength="255">
          </label>
          <label>Client ID
            <input name="client_id" value="${escapeHtml(config.client_id || '')}" maxlength="255">
          </label>
          <label>Data Directory
            <input name="dataDirectory" value="${escapeHtml(config.dataDirectory || '')}" maxlength="120">
          </label>
          <label style="grid-column:1/-1;">Maintenance Message
            <textarea name="maintenance_message">${escapeHtml(config.maintenance_message || '')}</textarea>
          </label>
          <div class="modal-actions" style="grid-column:1/-1; margin-top:0;">
            <button type="submit" class="primary">Save Launcher Configuration</button>
          </div>
        </form>
      </div>

      <div class="card" style="margin-top:1rem;">
        <div class="panel-head" style="margin-bottom:0.5rem;">
          <h3>Launcher News</h3>
          <button id="addNewsBtn" class="primary">Add News Item</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Title</th><th>Author</th><th>Publish Date</th><th>Actions</th></tr></thead>
            <tbody>${newsRows || '<tr><td colspan="4" class="muted">No news items yet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('refreshLauncherBtn')?.addEventListener('click', async () => {
      try {
        const launcher = await api('api/launcher.php');
        state.launcher = launcher.launcher || { config: {}, news: [] };
        renderLauncher();
        status('Launcher content refreshed');
      } catch (error) {
        status(error.message, true);
      }
    });

    document.getElementById('launcherConfigForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;

      try {
        const result = await api('api/launcher.php', {
          method: 'PATCH',
          body: {
            action: 'config',
            config: {
              maintenance: form.maintenance.value === 'true',
              maintenance_message: form.maintenance_message.value,
              online: form.online.value.trim(),
              client_id: form.client_id.value.trim(),
              dataDirectory: form.dataDirectory.value.trim()
            }
          }
        });

        state.launcher.config = result.config || {};
        renderLauncher();
        status('Launcher configuration saved');
      } catch (error) {
        status(error.message, true);
      }
    });

    document.getElementById('addNewsBtn')?.addEventListener('click', () => {
      openModal({
        title: 'Create News Item',
        contentHtml: `
          <form id="newsEditorForm" class="form-grid">
            <label style="grid-column:1/-1;">Title
              <input name="title" required maxlength="140">
            </label>
            <label style="grid-column:1/-1;">Content
              <textarea name="content" required></textarea>
            </label>
            <label>Author
              <input name="author" required maxlength="120">
            </label>
            <label>Publish Date
              <input name="publish_date" type="datetime-local">
            </label>
            <div class="modal-actions" style="grid-column:1/-1;">
              <button type="button" id="cancelNewsEditor" class="subtle">Cancel</button>
              <button type="submit" class="primary">Create News</button>
            </div>
          </form>
        `
      });

      document.getElementById('cancelNewsEditor')?.addEventListener('click', closeModal);
      document.getElementById('newsEditorForm')?.addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const form = submitEvent.currentTarget;
        const publishDateRaw = form.publish_date.value;

        const item = {
          title: form.title.value.trim(),
          content: form.content.value.trim(),
          author: form.author.value.trim()
        };

        if (publishDateRaw) {
          item.publish_date = new Date(publishDateRaw).toISOString();
        }

        try {
          const result = await api('api/launcher.php', {
            method: 'POST',
            body: { action: 'news.create', item }
          });
          closeModal();
          state.launcher.news = result.news || [];
          renderLauncher();
          status('News item created');
        } catch (error) {
          status(error.message, true);
        }
      });
    });

    launcherPanel.querySelectorAll('[data-news-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.dataset.newsAction;
        const index = Number(button.dataset.newsIndex);
        const item = news[index];
        closeActionMenus();

        if (!item) return;

        if (action === 'edit') {
          openModal({
            title: 'Edit News Item',
            contentHtml: `
              <form id="newsEditorForm" class="form-grid">
                <label style="grid-column:1/-1;">Title
                  <input name="title" required maxlength="140" value="${escapeHtml(item.title || '')}">
                </label>
                <label style="grid-column:1/-1;">Content
                  <textarea name="content" required>${escapeHtml(item.content || '')}</textarea>
                </label>
                <label>Author
                  <input name="author" required maxlength="120" value="${escapeHtml(item.author || '')}">
                </label>
                <label>Publish Date
                  <input name="publish_date" type="datetime-local" value="${escapeHtml(toDatetimeLocal(item.publish_date || ''))}">
                </label>
                <div class="modal-actions" style="grid-column:1/-1;">
                  <button type="button" id="cancelNewsEditor" class="subtle">Cancel</button>
                  <button type="submit" class="primary">Save News</button>
                </div>
              </form>
            `
          });

          document.getElementById('cancelNewsEditor')?.addEventListener('click', closeModal);
          document.getElementById('newsEditorForm')?.addEventListener('submit', async (submitEvent) => {
            submitEvent.preventDefault();
            const form = submitEvent.currentTarget;
            const publishDateRaw = form.publish_date.value;

            const updateItem = {
              title: form.title.value.trim(),
              content: form.content.value.trim(),
              author: form.author.value.trim()
            };

            if (publishDateRaw) {
              updateItem.publish_date = new Date(publishDateRaw).toISOString();
            }

            try {
              const result = await api('api/launcher.php', {
                method: 'PATCH',
                body: { action: 'news.update', index, item: updateItem }
              });
              closeModal();
              state.launcher.news = result.news || [];
              renderLauncher();
              status('News item updated');
            } catch (error) {
              status(error.message, true);
            }
          });

          return;
        }

        if (action === 'delete') {
          const confirmed = await askConfirm({
            title: 'Delete News Item',
            message: `Delete news "${item.title || 'item'}"?`,
            confirmText: 'Delete News',
            danger: true
          });

          if (!confirmed) return;

          try {
            const result = await api('api/launcher.php', {
              method: 'DELETE',
              body: {
                action: 'news.delete',
                index
              }
            });
            closeModal();
            state.launcher.news = result.news || [];
            renderLauncher();
            status('News item deleted');
          } catch (error) {
            status(error.message, true);
          }
        }
      });
    });
  }

  function renderSettings() {
    const settings = state.settings || {};

    els.panels.settings.innerHTML = `
      <h2>System Settings</h2>
      <div class="card">
        <form id="settingsForm" class="form-grid">
          <label>Site Name <input name="site_name" value="${escapeHtml(settings.site_name || '')}"></label>
          <label>Session Timeout (minutes) <input name="session_timeout_minutes" type="number" min="10" max="1440" value="${escapeHtml(settings.session_timeout_minutes ?? 120)}"></label>
          <label>Maintenance Mode
            <select name="maintenance_mode">
              <option value="false" ${settings.maintenance_mode ? '' : 'selected'}>Disabled</option>
              <option value="true" ${settings.maintenance_mode ? 'selected' : ''}>Enabled</option>
            </select>
          </label>
          <label>Allow Instance Delete
            <select name="allow_instance_delete">
              <option value="true" ${settings.allow_instance_delete ? 'selected' : ''}>Yes</option>
              <option value="false" ${settings.allow_instance_delete ? '' : 'selected'}>No</option>
            </select>
          </label>
          <button type="submit">Save Settings</button>
        </form>
      </div>
    `;

    document.getElementById('settingsForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = {
        site_name: form.site_name.value.trim(),
        session_timeout_minutes: Number(form.session_timeout_minutes.value),
        maintenance_mode: form.maintenance_mode.value === 'true',
        allow_instance_delete: form.allow_instance_delete.value === 'true'
      };

      try {
        const result = await api('api/settings.php', { method: 'PATCH', body: payload });
        state.settings = result.settings;
        renderSettings();
        status('Settings saved');
      } catch (error) {
        status(error.message, true);
      }
    });
  }

  async function loadFiles(instanceId, path = '') {
    if (!instanceId) return;
    try {
      const result = await api(`api/files.php?instance_id=${encodeURIComponent(instanceId)}&action=list&path=${encodeURIComponent(path)}`);
      state.file.instanceId = instanceId;
      state.file.path = result.cwd || '';
      state.file.items = result.items || [];
      state.file.writable = Boolean(result.writable);
      renderFiles();
    } catch (error) {
      status(error.message, true);
    }
  }

  function formatBytes(value) {
    if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return 'n/a';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let current = value;
    let unitIndex = 0;
    while (current >= 1024 && unitIndex < units.length - 1) {
      current /= 1024;
      unitIndex += 1;
    }
    return `${current.toFixed(1)} ${units[unitIndex]}`;
  }

  async function refreshData() {
    try {
      status('Loading admin data...');

      const sectionDefaults = {
        overview: true,
        instances: true,
        files: true,
        users: true,
        permissions: true,
        launcher: true,
        settings: true
      };
      state.sectionAccess = { ...sectionDefaults };

      const [overview, instances] = await Promise.all([
        api('api/overview.php'),
        api('api/instances.php')
      ]);

      state.overview = overview.overview || {};
      state.instances = instances.instances || [];

      const restrictedFetches = [
        {
          section: 'users',
          request: () => api('api/users.php'),
          onSuccess: (payload) => {
            state.users = payload.users || [];
          },
          onForbidden: () => {
            state.users = [];
          }
        },
        {
          section: 'permissions',
          request: () => api('api/permissions.php'),
          onSuccess: (payload) => {
            state.roles = payload.roles || {};
            state.rolesMeta = payload.roles_meta || {};
            state.builtinRoles = payload.builtin_roles || [];
            state.permissions = payload.permissions || [];
          },
          onForbidden: () => {
            state.roles = {};
            state.rolesMeta = {};
            state.builtinRoles = [];
            state.permissions = [];
          }
        },
        {
          section: 'settings',
          request: () => api('api/settings.php'),
          onSuccess: (payload) => {
            state.settings = payload.settings || {};
          },
          onForbidden: () => {
            state.settings = {};
          }
        },
        {
          section: 'launcher',
          request: () => api('api/launcher.php'),
          onSuccess: (payload) => {
            state.launcher = payload.launcher || { config: {}, news: [] };
          },
          onForbidden: () => {
            state.launcher = { config: {}, news: [] };
          }
        }
      ];

      await Promise.all(restrictedFetches.map(async (entry) => {
        try {
          const payload = await entry.request();
          state.sectionAccess[entry.section] = true;
          entry.onSuccess(payload);
        } catch (error) {
          if (!isForbiddenError(error)) {
            throw error;
          }

          state.sectionAccess[entry.section] = false;
          entry.onForbidden();
        }
      }));

      state.sectionAccess.files = state.instances.length > 0;

      applySectionAccess();

      if (!state.file.instanceId && state.instances.length) {
        state.file.instanceId = state.instances[0].id;
      }

      if (state.file.instanceId && !state.instances.find((instance) => instance.id === state.file.instanceId)) {
        state.file.instanceId = state.instances[0]?.id || '';
        state.file.path = '';
      }

      renderOverview();
      renderInstances();
      renderUsers();
      renderFiles();
      renderPermissions();
      renderLauncher();
      renderSettings();

      if (state.file.instanceId && state.sectionAccess.files !== false) {
        await loadFiles(state.file.instanceId, state.file.path || '');
      }

      switchSection(state.activeSection || initialSection);
      status('Ready');
    } catch (error) {
      status(error.message, true);
      throw error;
    }
  }

  async function hydrateSession() {
    try {
      const me = await api('api/auth.php?action=me');
      if (!me.authenticated) {
        state.authenticated = false;
        state.user = null;
        state.csrfToken = null;
        showLogin();
        return;
      }

      state.authenticated = true;
      state.user = me.user;
      state.csrfToken = me.csrf_token;
      showAdmin();
      await refreshData();
    } catch (error) {
      status(error.message, true);
      showLogin();
    }
  }

  function bindEvents() {
    els.loginForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (els.loginError) {
        els.loginError.textContent = '';
      }

      const form = event.currentTarget;
      const payload = {
        username: form.username.value.trim(),
        password: form.password.value
      };

      try {
        const result = await api('api/auth.php?action=login', {
          method: 'POST',
          body: payload
        });

        state.authenticated = true;
        state.user = result.user;
        state.csrfToken = result.csrf_token;
        showAdmin();
        await refreshData();
      } catch (error) {
        if (els.loginError) {
          els.loginError.textContent = error.message;
        }
      }
    });

    els.logoutBtn?.addEventListener('click', async () => {
      try {
        await api('api/auth.php?action=logout', { method: 'POST', body: {} });
      } catch (error) {
        status(error.message, true);
      }

      state.authenticated = false;
      state.user = null;
      state.csrfToken = null;
      showLogin();
    });

    els.nav?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-section]');
      if (!button) return;
      switchSection(button.dataset.section);
    });

    els.modalCloseBtn?.addEventListener('click', closeModal);

    els.modalRoot?.addEventListener('click', (event) => {
      const closeTarget = event.target.closest('[data-modal-close]');
      if (closeTarget) {
        closeModal();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && els.modalRoot && !els.modalRoot.classList.contains('hidden')) {
        closeModal();
      }
    });
  }

  bindEvents();
  hydrateSession();
})();






