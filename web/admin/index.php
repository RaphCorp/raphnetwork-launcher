<?php

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
admin_security_headers();

$currentUser = Auth::currentUser();
$authenticated = $currentUser !== null && Permissions::canAccessAdminPanel($currentUser);
$validSections = ['overview', 'instances', 'users', 'files', 'permissions', 'launcher', 'settings'];
$initialSection = (string) ($_GET['section'] ?? 'overview');
if (!in_array($initialSection, $validSections, true)) {
    $initialSection = 'overview';
}
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RaphNetwork Launcher Administration Panel</title>
    <link rel="stylesheet" href="assets/admin.css?v=<?php echo urlencode((string) (@filemtime(__DIR__ . "/assets/admin.css") ?: time())); ?>">
</head>
<body>
<div id="app" class="app-shell">
    <section id="loginView" class="login-view<?php echo $authenticated ? ' hidden' : ''; ?>">
        <div class="login-card">
            <h1>RaphNetwork Launcher Administration Panel</h1>
            <p>Secure access required</p>
            <form id="loginForm">
                <label>
                    Username
                    <input type="text" name="username" required minlength="3" maxlength="32" autocomplete="username">
                </label>
                <label>
                    Password
                    <input type="password" name="password" required minlength="8" autocomplete="current-password">
                </label>
                <button type="submit">Sign In</button>
            </form>
            <div id="loginError" class="error"></div>
        </div>
    </section>

    <section id="adminView" class="admin-view<?php echo $authenticated ? '' : ' hidden'; ?>">
        <aside class="sidebar">
            <div class="brand">RaphNetwork Launcher Administration Panel</div>
            <div class="brand-sub">Control center</div>
            <nav id="sidebarNav">
                <button data-section="overview" class="active">Overview</button>
                <button data-section="instances">Instances</button>
                <button data-section="users">Users</button>
                <button data-section="files">File Management</button>
                <button data-section="permissions">Permissions / Roles</button>
                <button data-section="launcher">Launcher Content</button>
                <button data-section="settings">System Settings</button>
            </nav>
        </aside>

        <main class="main-content">
            <header class="topbar">
                <div id="statusBar">Status: loading</div>
                <div class="topbar-actions">
                    <span id="currentUser"></span>
                    <button id="logoutBtn" class="danger">Logout</button>
                </div>
            </header>

            <section id="section-overview" class="panel active"></section>
            <section id="section-instances" class="panel"></section>
            <section id="section-users" class="panel"></section>
            <section id="section-files" class="panel"></section>
            <section id="section-permissions" class="panel"></section>
            <section id="section-launcher" class="panel"></section>
            <section id="section-settings" class="panel"></section>
        </main>
    </section>
</div>

<div id="modalRoot" class="modal-root hidden" aria-hidden="true">
    <div class="modal-overlay" data-modal-close="1"></div>
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="modal-head">
            <h3 id="modalTitle">Dialog</h3>
            <button id="modalCloseBtn" class="icon-btn" type="button" aria-label="Close">x</button>
        </div>
        <div id="modalBody" class="modal-body"></div>
    </div>
</div>

<div id="toastStack" class="toast-stack" aria-live="polite" aria-atomic="true"></div>

<script>
window.__ADMIN_BOOTSTRAP__ = {
    authenticated: <?php echo $authenticated ? 'true' : 'false'; ?>,
    user: <?php echo json_encode($authenticated ? admin_public_user($currentUser) : null, JSON_UNESCAPED_SLASHES); ?>,
    initialSection: <?php echo json_encode($initialSection, JSON_UNESCAPED_SLASHES); ?>
};
</script>
<script src="assets/admin.js?v=<?php echo urlencode((string) (@filemtime(__DIR__ . "/assets/admin.js") ?: time())); ?>"></script>
</body>
</html>