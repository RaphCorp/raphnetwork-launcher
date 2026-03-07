<?php

declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';
admin_security_headers();

$method = admin_require_method(['GET', 'POST']);
$currentUser = admin_require_auth();
admin_require_permission($currentUser, 'admin.access');

if ($method === 'GET') {
    $roles = [];
    foreach (Permissions::allRoles() as $role) {
        $roles[$role] = Permissions::rolePermissions($role);
    }

    admin_json_response([
        'success' => true,
        'roles' => $roles,
        'permissions' => Permissions::allPermissions(),
    ]);
}

admin_require_permission($currentUser, 'users.manage');
admin_require_csrf_for_mutation($method);

$body = admin_parse_body();
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
