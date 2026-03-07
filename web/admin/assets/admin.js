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
    userEditorId: null,
    file: {
      instanceId: '',
      path: '',
      selectedFile: '',
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

  function getMultiSelectValues(selectElement) {
    if (!selectElement) return [];
    return Array.from(selectElement.selectedOptions || []).map((option) => option.value).filter(Boolean);
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
      throw new Error(error);
    }

    return payload;
  }

  function switchSection(sectionName) {
    state.activeSection = sectionName;

    document.querySelectorAll('#sidebarNav button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.section === sectionName);
    });

    Object.entries(els.panels).forEach(([name, panel]) => {
      if (!panel) return;
      panel.classList.toggle('active', name === sectionName);
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
    const userOptions = state.users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.username)}</option>`).join('');

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
          const selectedAssignedUsers = state.users
            .filter((user) => Array.isArray(user.instances) && user.instances.includes(instance.id))
            .map((user) => user.id);

          const ownerOptions = state.users.map((user) => {
            const selected = user.id === instance.owner ? 'selected' : '';
            return `<option value="${escapeHtml(user.id)}" ${selected}>${escapeHtml(user.username)}</option>`;
          }).join('');

          const userMultiOptions = state.users.map((user) => {
            const isAdmin = selectedAdmins.includes(user.id) ? 'selected' : '';
            return `<option value="${escapeHtml(user.id)}" ${isAdmin}>${escapeHtml(user.username)} (${escapeHtml(user.id)})</option>`;
          }).join('');

          const assignedUserOptions = state.users.map((user) => {
            const selected = selectedAssignedUsers.includes(user.id) ? 'selected' : '';
            return `<option value="${escapeHtml(user.id)}" ${selected}>${escapeHtml(user.username)} (${escapeHtml(user.id)})</option>`;
          }).join('');

          openModal({
            title: `Edit Instance: ${instance.name}`,
            contentHtml: `
              <form id="editInstanceModalForm" class="form-grid">
                <input type="hidden" name="id" value="${escapeHtml(instance.id)}">
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
                <div class="modal-actions" style="grid-column:1/-1;">
                  <button type="button" id="cancelEditInstance" class="subtle">Cancel</button>
                  <button type="submit" class="primary">Save Changes</button>
                </div>
              </form>
            `
          });

          document.getElementById('cancelEditInstance')?.addEventListener('click', closeModal);
          document.getElementById('editInstanceModalForm')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = event.currentTarget;

            try {
              await api('api/instances.php', {
                method: 'PATCH',
                body: {
                  id: form.id.value,
                  name: form.name.value.trim(),
                  owner: form.owner.value,
                  status: form.status.value,
                  admins: getMultiSelectValues(form.admins),
                  assigned_users: getMultiSelectValues(form.assigned_users)
                }
              });
              closeModal();
              await refreshData();
              status('Instance updated');
            } catch (error) {
              status(error.message, true);
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
                <option>USER</option>
                <option>INSTANCE_ADMIN</option>
                <option>SUPER_ADMIN</option>
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
                <option ${editingUser?.role === 'USER' ? 'selected' : ''}>USER</option>
                <option ${editingUser?.role === 'INSTANCE_ADMIN' ? 'selected' : ''}>INSTANCE_ADMIN</option>
                <option ${editingUser?.role === 'SUPER_ADMIN' ? 'selected' : ''}>SUPER_ADMIN</option>
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

    const rows = (state.file.items || []).map((item) => {
      return `
        <tr>
          <td>${escapeHtml(item.type)}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.path)}</td>
          <td>${item.size != null ? escapeHtml(item.size) : '-'}</td>
          <td class="actions">
            ${item.type === 'directory' ? `<button data-open-dir="${escapeHtml(item.path)}">Open</button>` : `<button data-open-file="${escapeHtml(item.path)}">Edit</button>`}
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
        </div>
        <p class="muted">Uploads and edits require write access on this folder for the PHP process.</p>
        <div class="toolbar">
          <input type="text" id="mkdirInput" placeholder="new-folder" ${isReadOnly ? 'disabled' : ''}>
          <button id="mkdirBtn" ${isReadOnly ? 'disabled' : ''}>Create Folder</button>
          <input type="file" id="uploadInput" ${isReadOnly ? 'disabled' : ''}>
          <button id="uploadBtn" ${isReadOnly ? 'disabled' : ''}>Upload</button>
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
        <button id="saveFileBtn" class="primary" style="margin-top:0.6rem;" ${isReadOnly ? 'disabled' : ''}>Save File</button>
      </div>
    `;

    const instanceSelect = document.getElementById('fileInstanceSelect');
    instanceSelect.value = state.file.instanceId || state.instances[0]?.id || '';
    state.file.instanceId = instanceSelect.value;

    document.getElementById('goInstancesBtn')?.addEventListener('click', () => {
      switchSection('instances');
    });

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
          await loadFiles(state.file.instanceId, state.file.path);
          status('Path deleted');
        } catch (error) {
          status(error.message, true);
        }
      });
    });
  }

  function renderPermissions() {
    const roles = Object.keys(state.roles || {});
    const allPermissions = state.permissions || [];

    const matrixHeader = roles.map((role) => `<th>${escapeHtml(role)}</th>`).join('');
    const matrixRows = allPermissions.map((permission) => {
      const columns = roles.map((role) => {
        const allowed = permissionMatches(permission, state.roles?.[role] || []);
        return `<td>${allowed ? '<span class="badge good">allow</span>' : '<span class="badge warn">deny</span>'}</td>`;
      }).join('');
      return `<tr><td>${escapeHtml(permission)}</td>${columns}</tr>`;
    }).join('');

    const userOptions = state.users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.username)} (${escapeHtml(user.role)})</option>`).join('');
    const instanceOptions = `<option value="">Global context</option>` + state.instances.map((instance) => `<option value="${escapeHtml(instance.id)}">${escapeHtml(instance.name)}</option>`).join('');

    els.panels.permissions.innerHTML = `
      <h2>Permissions / Roles</h2>
      <div class="card">
        <h3>Role Permission Matrix</h3>
        <p class="muted">This matrix shows role defaults. Use the inspector to understand final permissions for one user.</p>
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
  }

  function renderLauncher() {
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

    els.panels.launcher.innerHTML = `
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

    els.panels.launcher.querySelectorAll('[data-news-action]').forEach((button) => {
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
      const [overview, instances, users, permissions, settings, launcher] = await Promise.all([
        api('api/overview.php'),
        api('api/instances.php'),
        api('api/users.php'),
        api('api/permissions.php'),
        api('api/settings.php'),
        api('api/launcher.php')
      ]);

      state.overview = overview.overview;
      state.instances = instances.instances || [];
      state.users = users.users || [];
      state.roles = permissions.roles || {};
      state.permissions = permissions.permissions || [];
      state.settings = settings.settings || {};
      state.launcher = launcher.launcher || { config: {}, news: [] };

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

      if (state.file.instanceId) {
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







