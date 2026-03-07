(() => {
  const initialSection = window.__ADMIN_BOOTSTRAP__?.initialSection || 'overview';

  const state = {
    csrfToken: null,
    user: window.__ADMIN_BOOTSTRAP__?.user || null,
    authenticated: Boolean(window.__ADMIN_BOOTSTRAP__?.authenticated),
    overview: null,
    instances: [],
    users: [],
    roles: {},
    permissions: [],
    settings: {},
    file: {
      instanceId: '',
      path: '',
      selectedFile: '',
      content: '',
      items: []
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
    panels: {
      overview: document.getElementById('section-overview'),
      instances: document.getElementById('section-instances'),
      users: document.getElementById('section-users'),
      files: document.getElementById('section-files'),
      permissions: document.getElementById('section-permissions'),
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

  function status(message, isError = false) {
    els.statusBar.textContent = message;
    els.statusBar.style.color = isError ? '#ffb1b1' : '';
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
      throw new Error(error);
    }

    return payload;
  }

  function switchSection(sectionName) {
    document.querySelectorAll('#sidebarNav button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.section === sectionName);
    });

    Object.entries(els.panels).forEach(([name, panel]) => {
      panel.classList.toggle('active', name === sectionName);
    });
  }

  function showAdmin() {
    els.loginView.classList.add('hidden');
    els.adminView.classList.remove('hidden');
    els.currentUser.textContent = `${state.user?.username || 'unknown'} (${state.user?.role || 'n/a'})`;
  }

  function showLogin() {
    els.adminView.classList.add('hidden');
    els.loginView.classList.remove('hidden');
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
    const userOptions = state.users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.username)}</option>`).join('');

    const rows = state.instances.map((instance) => {
      const admins = Array.isArray(instance.admins) ? instance.admins.join(', ') : '';
      const protectedDelete = instance.owner === 'root' ? '' : '';
      return `
        <tr>
          <td>${escapeHtml(instance.id)}</td>
          <td>${escapeHtml(instance.name)}</td>
          <td>${escapeHtml(instance.owner || 'n/a')}</td>
          <td>${escapeHtml(instance.status || 'unknown')}</td>
          <td>${escapeHtml(admins)}</td>
          <td><small>${escapeHtml(instance.filesystem_path || '')}</small></td>
          <td class="actions">
            <button data-edit-instance="${escapeHtml(instance.id)}">Edit</button>
            <button data-delete-instance="${escapeHtml(instance.id)}" class="danger" ${protectedDelete}>Delete</button>
          </td>
        </tr>
      `;
    }).join('');

    els.panels.instances.innerHTML = `
      <h2>Instances</h2>
      <div class="card">
        <h3>Create Instance</h3>
        <form id="createInstanceForm" class="form-grid">
          <label>Name <input name="name" required minlength="2" maxlength="64"></label>
          <label>Owner <select name="owner">${userOptions}</select></label>
          <button type="submit">Create</button>
        </form>
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

    document.getElementById('createInstanceForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = {
        name: form.name.value.trim(),
        owner: form.owner.value
      };

      try {
        await api('api/instances.php', { method: 'POST', body: payload });
        await refreshData();
        status('Instance created');
      } catch (error) {
        status(error.message, true);
      }
    });

    els.panels.instances.querySelectorAll('[data-edit-instance]').forEach((button) => {
      button.addEventListener('click', async () => {
        const instanceId = button.dataset.editInstance;
        const instance = state.instances.find((item) => item.id === instanceId);
        if (!instance) return;

        const name = prompt('Instance name', instance.name || '');
        if (name === null) return;

        const statusValue = prompt('Status (online/offline/maintenance/unknown)', instance.status || 'unknown');
        if (statusValue === null) return;

        const adminsRaw = prompt('Admins (comma-separated user IDs)', (instance.admins || []).join(','));
        if (adminsRaw === null) return;

        const admins = adminsRaw.split(',').map((v) => v.trim()).filter(Boolean);

        try {
          await api('api/instances.php', {
            method: 'PATCH',
            body: {
              id: instanceId,
              name,
              status: statusValue,
              admins,
              assigned_users: admins
            }
          });
          await refreshData();
          status('Instance updated');
        } catch (error) {
          status(error.message, true);
        }
      });
    });

    els.panels.instances.querySelectorAll('[data-delete-instance]').forEach((button) => {
      button.addEventListener('click', async () => {
        const instanceId = button.dataset.deleteInstance;
        const removeFiles = confirm('Delete instance files too? Click OK for full deletion, Cancel to keep files.');
        const confirmed = confirm(`Delete instance ${instanceId}?`);
        if (!confirmed) return;

        try {
          await api('api/instances.php', {
            method: 'DELETE',
            body: { id: instanceId, remove_files: removeFiles }
          });
          await refreshData();
          status('Instance deleted');
        } catch (error) {
          status(error.message, true);
        }
      });
    });
  }

  function renderUsers() {
    const instanceOptions = state.instances.map((instance) => `<option value="${escapeHtml(instance.id)}">${escapeHtml(instance.name)}</option>`).join('');

    const rows = state.users.map((user) => {
      const protectedBadge = user.protected ? '<span class="badge warn">protected</span>' : '';
      return `
        <tr>
          <td>${escapeHtml(user.id)}</td>
          <td>${escapeHtml(user.username)} ${protectedBadge}</td>
          <td>${escapeHtml(user.email || '')}</td>
          <td>${escapeHtml(user.role || '')}</td>
          <td>${escapeHtml((user.instances || []).join(', '))}</td>
          <td class="actions">
            <button data-edit-user="${escapeHtml(user.id)}" ${user.protected ? 'disabled' : ''}>Edit</button>
            <button data-delete-user="${escapeHtml(user.id)}" class="danger" ${user.protected ? 'disabled' : ''}>Delete</button>
          </td>
        </tr>
      `;
    }).join('');

    els.panels.users.innerHTML = `
      <h2>Users</h2>
      <div class="card">
        <h3>Create User</h3>
        <form id="createUserForm" class="form-grid">
          <label>Username <input name="username" required minlength="3" maxlength="32"></label>
          <label>Email <input name="email" type="email" required></label>
          <label>Password <input name="password" type="password" required minlength="8"></label>
          <label>Role
            <select name="role">
              <option>USER</option>
              <option>INSTANCE_ADMIN</option>
              <option>SUPER_ADMIN</option>
            </select>
          </label>
          <label>Instance assignment
            <select name="instance_id">
              <option value="">No initial instance</option>
              ${instanceOptions}
            </select>
          </label>
          <button type="submit">Create</button>
        </form>
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
      const firstInstance = form.instance_id.value;
      const payload = {
        username: form.username.value.trim(),
        email: form.email.value.trim(),
        password: form.password.value,
        role: form.role.value,
        instances: firstInstance ? [firstInstance] : [],
        admin_instance_ids: form.role.value === 'INSTANCE_ADMIN' && firstInstance ? [firstInstance] : []
      };

      try {
        await api('api/users.php', { method: 'POST', body: payload });
        await refreshData();
        status('User created');
      } catch (error) {
        status(error.message, true);
      }
    });

    els.panels.users.querySelectorAll('[data-edit-user]').forEach((button) => {
      button.addEventListener('click', async () => {
        const userId = button.dataset.editUser;
        const user = state.users.find((item) => item.id === userId);
        if (!user) return;

        const email = prompt('Email', user.email || '');
        if (email === null) return;

        const role = prompt('Role (SUPER_ADMIN, INSTANCE_ADMIN, USER)', user.role || 'USER');
        if (role === null) return;

        const instancesRaw = prompt('Instance IDs (comma-separated)', (user.instances || []).join(','));
        if (instancesRaw === null) return;

        const instances = instancesRaw.split(',').map((v) => v.trim()).filter(Boolean);

        try {
          await api('api/users.php', {
            method: 'PATCH',
            body: {
              id: userId,
              email,
              role,
              instances,
              admin_instance_ids: role === 'INSTANCE_ADMIN' ? instances : []
            }
          });
          await refreshData();
          status('User updated');
        } catch (error) {
          status(error.message, true);
        }
      });
    });

    els.panels.users.querySelectorAll('[data-delete-user]').forEach((button) => {
      button.addEventListener('click', async () => {
        const userId = button.dataset.deleteUser;
        if (!confirm(`Delete user ${userId}?`)) return;

        try {
          await api('api/users.php', { method: 'DELETE', body: { id: userId } });
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

    const rows = (state.file.items || []).map((item) => {
      return `
        <tr>
          <td>${escapeHtml(item.type)}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.path)}</td>
          <td>${item.size != null ? escapeHtml(item.size) : '-'}</td>
          <td class="actions">
            ${item.type === 'directory' ? `<button data-open-dir="${escapeHtml(item.path)}">Open</button>` : `<button data-open-file="${escapeHtml(item.path)}">Edit</button>`}
            <button class="danger" data-delete-path="${escapeHtml(item.path)}">Delete</button>
          </td>
        </tr>
      `;
    }).join('');

    els.panels.files.innerHTML = `
      <h2>File Management</h2>
      <div class="card">
        <div class="toolbar">
          <label>Instance
            <select id="fileInstanceSelect">${options}</select>
          </label>
          <label>Path
            <input id="filePathInput" placeholder="config" value="${escapeHtml(state.file.path || '')}">
          </label>
          <button id="fileLoadBtn">Load</button>
        </div>
        <div class="toolbar">
          <input type="text" id="mkdirInput" placeholder="new-folder">
          <button id="mkdirBtn">Create Folder</button>
          <input type="file" id="uploadInput">
          <button id="uploadBtn">Upload</button>
        </div>
      </div>

      <div class="table-wrap" style="margin-top:1rem;">
        <table>
          <thead><tr><th>Type</th><th>Name</th><th>Path</th><th>Size</th><th>Actions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div class="card" style="margin-top:1rem;">
        <h3>Editor</h3>
        <p class="muted">File: <span id="editorPath">${escapeHtml(state.file.selectedFile || 'none')}</span></p>
        <textarea id="fileEditor">${escapeHtml(state.file.content || '')}</textarea>
        <button id="saveFileBtn" style="margin-top:0.6rem;">Save File</button>
      </div>
    `;

    const instanceSelect = document.getElementById('fileInstanceSelect');
    instanceSelect.value = state.file.instanceId || state.instances[0]?.id || '';
    state.file.instanceId = instanceSelect.value;

    document.getElementById('fileLoadBtn')?.addEventListener('click', async () => {
      state.file.instanceId = instanceSelect.value;
      state.file.path = document.getElementById('filePathInput').value.trim();
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
      if (!uploadInput.files?.[0]) {
        return;
      }

      const formData = new FormData();
      formData.append('path', state.file.path || '');
      formData.append('file', uploadInput.files[0]);

      try {
        await api(`api/files.php?instance_id=${encodeURIComponent(state.file.instanceId)}&action=upload`, {
          method: 'POST',
          body: formData,
          isForm: true
        });
        uploadInput.value = '';
        await loadFiles(state.file.instanceId, state.file.path);
        status('File uploaded');
      } catch (error) {
        status(error.message, true);
      }
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

    els.panels.files.querySelectorAll('[data-delete-path]').forEach((button) => {
      button.addEventListener('click', async () => {
        const path = button.dataset.deletePath;
        if (!confirm(`Delete ${path}?`)) return;

        try {
          await api(`api/files.php?instance_id=${encodeURIComponent(state.file.instanceId)}&action=delete`, {
            method: 'DELETE',
            body: { path }
          });
          await loadFiles(state.file.instanceId, state.file.path);
          status('Path deleted');
        } catch (error) {
          status(error.message, true);
        }
      });
    });
  }

  function renderPermissions() {
    const roleBlocks = Object.entries(state.roles || {}).map(([role, perms]) => {
      const badges = (perms || []).map((perm) => `<span class="badge">${escapeHtml(perm)}</span>`).join('');
      return `<div class="card"><h3>${escapeHtml(role)}</h3><div>${badges || '<span class="muted">No permissions</span>'}</div></div>`;
    }).join('');

    const userOptions = state.users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.username)}</option>`).join('');
    const instanceOptions = `<option value="">Global</option>` + state.instances.map((instance) => `<option value="${escapeHtml(instance.id)}">${escapeHtml(instance.name)}</option>`).join('');

    els.panels.permissions.innerHTML = `
      <h2>Permissions / Roles</h2>
      <div class="grid cards">${roleBlocks}</div>
      <div class="card" style="margin-top:1rem;">
        <h3>Evaluate Effective Permissions</h3>
        <form id="permissionEvalForm" class="form-grid">
          <label>User <select name="user_id">${userOptions}</select></label>
          <label>Instance <select name="instance_id">${instanceOptions}</select></label>
          <button type="submit">Evaluate</button>
        </form>
        <pre id="permissionEvalResult" class="muted" style="white-space:pre-wrap;margin:0;"></pre>
      </div>
    `;

    document.getElementById('permissionEvalForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = {
        user_id: form.user_id.value,
        instance_id: form.instance_id.value
      };

      try {
        const result = await api('api/permissions.php', { method: 'POST', body: payload });
        document.getElementById('permissionEvalResult').textContent = JSON.stringify(result.effective_permissions, null, 2);
      } catch (error) {
        document.getElementById('permissionEvalResult').textContent = error.message;
      }
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
      const [overview, instances, users, permissions, settings] = await Promise.all([
        api('api/overview.php'),
        api('api/instances.php'),
        api('api/users.php'),
        api('api/permissions.php'),
        api('api/settings.php')
      ]);

      state.overview = overview.overview;
      state.instances = instances.instances || [];
      state.users = users.users || [];
      state.roles = permissions.roles || {};
      state.permissions = permissions.permissions || [];
      state.settings = settings.settings || {};

      if (!state.file.instanceId && state.instances.length) {
        state.file.instanceId = state.instances[0].id;
      }

      renderOverview();
      renderInstances();
      renderUsers();
      renderFiles();
      renderPermissions();
      renderSettings();
      switchSection(initialSection);

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
      els.loginError.textContent = '';

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
        els.loginError.textContent = error.message;
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
  }

  bindEvents();
  hydrateSession();
})();



