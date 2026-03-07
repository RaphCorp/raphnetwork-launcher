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

admin_json_response([
    'success' => true,
    'user_id' => $userId,
    'instance_id' => $instanceId !== '' ? $instanceId : null,
    'effective_permissions' => $effective,
]);
