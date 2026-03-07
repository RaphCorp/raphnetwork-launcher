<?php

declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';
admin_security_headers();

$method = admin_require_method(['GET', 'POST', 'PATCH', 'DELETE']);
$currentUser = admin_require_auth();
admin_require_permission($currentUser, 'admin.access');

$body = admin_parse_body();
$defaultAction = $method === 'GET' ? 'list' : ($method === 'POST' && isset($body['user_id']) ? 'inspect' : '');
$action = strtolower((string) ($_GET['action'] ?? ($body['action'] ?? $defaultAction)));

$rolePattern = '/^[A-Z][A-Z0-9_]{2,63}$/';

$rolesPayload = static function (): array {
    $roles = [];
    $meta = Permissions::roleMetadata();

    foreach ($meta as $role => $entry) {
        $roles[$role] = is_array($entry['permissions'] ?? null) ? $entry['permissions'] : [];
    }

    return [
        'roles' => $roles,
        'roles_meta' => $meta,
        'permissions' => Permissions::allPermissions(),
        'builtin_roles' => Permissions::builtinRoles(),
    ];
};

$readCustomRoles = static function (): array {
    $settings = DataStore::loadSettings();
    $raw = $settings['custom_roles'] ?? [];
    return is_array($raw) ? $raw : [];
};

$saveCustomRoles = static function (array $customRoles): void {
    $settings = DataStore::loadSettings();
    $settings['custom_roles'] = $customRoles;
    $settings['updated_at'] = DataStore::nowIso();
    DataStore::saveSettings($settings);
};

$assertSuperAdmin = static function () use ($currentUser): void {
    if (!Permissions::isRoot($currentUser) && ($currentUser['role'] ?? '') !== Permissions::ROLE_SUPER_ADMIN) {
        admin_json_response(['success' => false, 'error' => 'Only SUPER_ADMIN can manage roles'], 403);
    }
};

if ($method === 'GET') {
    admin_json_response(array_merge(['success' => true], $rolesPayload()));
}

admin_require_csrf_for_mutation($method);

if ($method === 'POST' && $action === 'inspect') {
    admin_require_permission($currentUser, 'users.manage');

    $userId = (string) ($body['user_id'] ?? '');
    $instanceId = (string) ($body['instance_id'] ?? '');

    if ($userId === '') {
        admin_json_response(['success' => false, 'error' => 'user_id is required'], 422);
    }

    $users = DataStore::loadUsers();
    $user = DataStore::findUserById($users, $userId);
    if ($user === null) {
        admin_json_response(['success' => false, 'error' => 'User not found'], 404);
    }

    $effective = Permissions::effectivePermissions($user, $instanceId !== '' ? $instanceId : null);
    $role = (string) ($user['role'] ?? Permissions::ROLE_USER);
    $rolePermissions = Permissions::rolePermissions($role);
    $customGlobalPermissions = is_array($user['permissions'] ?? null)
        ? array_values(array_unique(array_filter($user['permissions'], 'is_string')))
        : [];
    $instancePermissionMap = is_array($user['instance_permissions'] ?? null) ? $user['instance_permissions'] : [];
    $instanceScopedPermissions = [];
    if ($instanceId !== '') {
        $instanceScopedPermissions = is_array($instancePermissionMap[$instanceId] ?? null)
            ? array_values(array_unique(array_filter($instancePermissionMap[$instanceId], 'is_string')))
            : [];
    }

    admin_json_response([
        'success' => true,
        'user_id' => $userId,
        'instance_id' => $instanceId !== '' ? $instanceId : null,
        'role' => $role,
        'role_permissions' => $rolePermissions,
        'custom_permissions' => $customGlobalPermissions,
        'instance_permissions' => $instanceScopedPermissions,
        'effective_permissions' => $effective,
    ]);
}

if ($method === 'POST' && $action === 'role.create') {
    $assertSuperAdmin();

    $role = strtoupper(trim((string) ($body['role'] ?? '')));
    if ($role === '' || !preg_match($rolePattern, $role)) {
        admin_json_response(['success' => false, 'error' => 'Invalid role name format'], 422);
    }

    if (Permissions::roleExists($role)) {
        admin_json_response(['success' => false, 'error' => 'Role already exists'], 409);
    }

    $permissions = Validator::permissionsArray($body['permissions'] ?? []);
    $customRoles = $readCustomRoles();
    $customRoles[$role] = $permissions;
    $saveCustomRoles($customRoles);

    admin_json_response(array_merge([
        'success' => true,
        'message' => 'Role created',
    ], $rolesPayload()), 201);
}

if ($method === 'PATCH' && $action === 'role.update') {
    $assertSuperAdmin();

    $role = strtoupper(trim((string) ($body['role'] ?? '')));
    if ($role === '' || !preg_match($rolePattern, $role)) {
        admin_json_response(['success' => false, 'error' => 'Invalid role name format'], 422);
    }

    if ($role === Permissions::ROLE_SUPER_ADMIN) {
        admin_json_response(['success' => false, 'error' => 'SUPER_ADMIN role cannot be modified'], 403);
    }

    if (!Permissions::roleExists($role)) {
        admin_json_response(['success' => false, 'error' => 'Role not found'], 404);
    }

    $permissions = Validator::permissionsArray($body['permissions'] ?? []);
    $customRoles = $readCustomRoles();
    $customRoles[$role] = $permissions;
    $saveCustomRoles($customRoles);

    admin_json_response(array_merge([
        'success' => true,
        'message' => 'Role updated',
    ], $rolesPayload()));
}

if ($method === 'DELETE' && $action === 'role.delete') {
    $assertSuperAdmin();

    $role = strtoupper(trim((string) ($body['role'] ?? ($_GET['role'] ?? ''))));
    if ($role === '' || !preg_match($rolePattern, $role)) {
        admin_json_response(['success' => false, 'error' => 'Invalid role name format'], 422);
    }

    if (Permissions::isBuiltinRole($role)) {
        admin_json_response(['success' => false, 'error' => 'Built-in roles cannot be deleted'], 403);
    }

    $customRoles = $readCustomRoles();
    if (!array_key_exists($role, $customRoles)) {
        admin_json_response(['success' => false, 'error' => 'Role not found'], 404);
    }

    unset($customRoles[$role]);
    $saveCustomRoles($customRoles);

    $users = DataStore::loadUsers();
    $changed = false;

    foreach ($users as &$user) {
        if (($user['role'] ?? '') === $role && !Permissions::isRoot($user) && (($user['protected'] ?? false) !== true)) {
            $user['role'] = Permissions::ROLE_USER;
            $changed = true;
        }
    }
    unset($user);

    if ($changed) {
        DataStore::saveUsers($users);
    }

    admin_json_response(array_merge([
        'success' => true,
        'message' => 'Role deleted',
    ], $rolesPayload()));
}

admin_json_response(['success' => false, 'error' => 'Unsupported permissions action'], 400);