<?php

declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';
admin_security_headers();

$method = admin_require_method(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
$currentUser = admin_require_auth();

$users = DataStore::loadUsers();
$instances = DataStore::loadInstances();
$body = admin_parse_body();

$sanitizeUser = static function (array $user): array {
    return admin_public_user($user);
};

$syncUserRelations = static function (array $targetUser, array $instanceIds, array $adminInstanceIds, array &$instances): array {
    $instanceIds = array_values(array_unique($instanceIds));
    $adminInstanceIds = array_values(array_unique($adminInstanceIds));

    foreach ($adminInstanceIds as $instanceId) {
        if (!in_array($instanceId, $instanceIds, true)) {
            $instanceIds[] = $instanceId;
        }
    }

    foreach ($instances as &$instance) {
        $id = (string) ($instance['id'] ?? '');
        $admins = is_array($instance['admins'] ?? null) ? array_values(array_unique($instance['admins'])) : [];

        if (in_array($id, $adminInstanceIds, true)) {
            if (!in_array($targetUser['id'], $admins, true)) {
                $admins[] = $targetUser['id'];
            }
        } else {
            $admins = array_values(array_filter($admins, static function ($adminId) use ($targetUser): bool {
                return $adminId !== $targetUser['id'];
            }));
        }

        if (!in_array('root', $admins, true)) {
            $admins[] = 'root';
        }

        $instance['admins'] = array_values(array_unique($admins));
    }
    unset($instance);

    $targetUser['instances'] = $instanceIds;
    return $targetUser;
};

$findUserIndexById = static function (array $items, string $id): ?int {
    foreach ($items as $index => $candidate) {
        if (($candidate['id'] ?? '') === $id) {
            return $index;
        }
    }

    return null;
};

if ($method === 'GET') {
    admin_require_permission($currentUser, 'users.manage');

    $userId = (string) ($_GET['id'] ?? '');
    if ($userId !== '') {
        $user = DataStore::findUserById($users, $userId);
        if ($user === null) {
            admin_json_response(['success' => false, 'error' => 'User not found'], 404);
        }

        admin_json_response(['success' => true, 'user' => $sanitizeUser($user)]);
    }

    $sanitizedUsers = array_map($sanitizeUser, $users);
    admin_json_response(['success' => true, 'users' => $sanitizedUsers]);
}

if ($method === 'POST') {
    admin_require_permission($currentUser, 'users.create');
    admin_require_csrf_for_mutation($method);

    try {
        $username = Validator::username(Validator::requireString($body, 'username', 3, 32));
        $email = Validator::email(Validator::requireString($body, 'email', 5, 190));
        $password = Validator::requireString($body, 'password', 8, 255);
        $role = Validator::role(Validator::requireString($body, 'role', 4, 32));
        $instanceIds = is_array($body['instances'] ?? null) ? array_values(array_unique($body['instances'])) : [];
        $adminInstanceIds = is_array($body['admin_instance_ids'] ?? null) ? array_values(array_unique($body['admin_instance_ids'])) : [];
        $permissions = Validator::permissionsArray($body['permissions'] ?? []);
        $instancePermissions = is_array($body['instance_permissions'] ?? null) ? $body['instance_permissions'] : [];
    } catch (InvalidArgumentException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
    }

    foreach ($users as $candidate) {
        if (($candidate['username'] ?? '') === $username) {
            admin_json_response(['success' => false, 'error' => 'Username already exists'], 409);
        }

        if (strtolower((string) ($candidate['email'] ?? '')) === $email) {
            admin_json_response(['success' => false, 'error' => 'Email already exists'], 409);
        }
    }

    if ($role === Permissions::ROLE_SUPER_ADMIN && !Permissions::hasPermission($currentUser, 'users.delete')) {
        admin_json_response(['success' => false, 'error' => 'Only super administrators can create SUPER_ADMIN users'], 403);
    }

    $instanceMap = DataStore::indexById($instances);
    foreach ($instanceIds as $instanceId) {
        if (!isset($instanceMap[$instanceId])) {
            admin_json_response(['success' => false, 'error' => 'Invalid instance assignment: ' . $instanceId], 422);
        }
    }

    foreach ($adminInstanceIds as $instanceId) {
        if (!isset($instanceMap[$instanceId])) {
            admin_json_response(['success' => false, 'error' => 'Invalid admin instance assignment: ' . $instanceId], 422);
        }
    }

    $newUser = [
        'id' => DataStore::generateId('usr'),
        'username' => $username,
        'email' => $email,
        'password_hash' => password_hash($password, PASSWORD_DEFAULT),
        'role' => $role,
        'instances' => $instanceIds,
        'permissions' => $permissions,
        'instance_permissions' => is_array($instancePermissions) ? $instancePermissions : [],
        'created_at' => DataStore::nowIso(),
        'protected' => false,
    ];

    $newUser = $syncUserRelations($newUser, $instanceIds, $adminInstanceIds, $instances);

    $users[] = $newUser;
    DataStore::saveUsers($users);
    DataStore::saveInstances($instances);

    admin_json_response(['success' => true, 'user' => $sanitizeUser($newUser)], 201);
}

if ($method === 'PUT' || $method === 'PATCH') {
    admin_require_permission($currentUser, 'users.manage');
    admin_require_csrf_for_mutation($method);

    $userId = (string) ($body['id'] ?? ($_GET['id'] ?? ''));
    if ($userId === '') {
        admin_json_response(['success' => false, 'error' => 'User id is required'], 422);
    }

    $index = $findUserIndexById($users, $userId);
    if ($index === null) {
        admin_json_response(['success' => false, 'error' => 'User not found'], 404);
    }

    $targetUser = $users[$index];

    if (Permissions::isRoot($targetUser) || (($targetUser['protected'] ?? false) === true)) {
        admin_json_response(['success' => false, 'error' => 'Protected root account cannot be modified'], 403);
    }

    $editableFields = ['email', 'role', 'instances', 'permissions', 'instance_permissions', 'admin_instance_ids', 'password'];
    $hasEditablePayload = false;
    foreach ($editableFields as $field) {
        if (array_key_exists($field, $body)) {
            $hasEditablePayload = true;
            break;
        }
    }

    if (!$hasEditablePayload) {
        admin_json_response(['success' => false, 'error' => 'No updatable fields provided'], 422);
    }

    try {
        if (array_key_exists('email', $body)) {
            $targetUser['email'] = Validator::email(Validator::requireString($body, 'email', 5, 190));
        }

        if (array_key_exists('role', $body)) {
            $newRole = Validator::role(Validator::requireString($body, 'role', 4, 32));
            if ($newRole === Permissions::ROLE_SUPER_ADMIN && !Permissions::hasPermission($currentUser, 'users.delete')) {
                admin_json_response(['success' => false, 'error' => 'Only super administrators can promote to SUPER_ADMIN'], 403);
            }
            $targetUser['role'] = $newRole;
        }

        if (array_key_exists('password', $body)) {
            $newPassword = Validator::requireString($body, 'password', 8, 255);
            $targetUser['password_hash'] = password_hash($newPassword, PASSWORD_DEFAULT);
        }

        $instanceIds = is_array($body['instances'] ?? null) ? array_values(array_unique($body['instances'])) : (is_array($targetUser['instances'] ?? null) ? $targetUser['instances'] : []);
        $adminInstanceIds = is_array($body['admin_instance_ids'] ?? null) ? array_values(array_unique($body['admin_instance_ids'])) : [];

        $instanceMap = DataStore::indexById($instances);
        foreach ($instanceIds as $instanceId) {
            if (!isset($instanceMap[$instanceId])) {
                admin_json_response(['success' => false, 'error' => 'Invalid instance assignment: ' . $instanceId], 422);
            }
        }

        foreach ($adminInstanceIds as $instanceId) {
            if (!isset($instanceMap[$instanceId])) {
                admin_json_response(['success' => false, 'error' => 'Invalid admin instance assignment: ' . $instanceId], 422);
            }
        }

        if (array_key_exists('permissions', $body)) {
            $targetUser['permissions'] = Validator::permissionsArray($body['permissions']);
        }

        if (array_key_exists('instance_permissions', $body)) {
            $targetUser['instance_permissions'] = is_array($body['instance_permissions']) ? $body['instance_permissions'] : [];
        }

        $targetUser = $syncUserRelations($targetUser, $instanceIds, $adminInstanceIds, $instances);
    } catch (InvalidArgumentException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
    }

    foreach ($users as $candidateIndex => $candidate) {
        if ($candidateIndex === $index) {
            continue;
        }

        if (strtolower((string) ($candidate['email'] ?? '')) === strtolower((string) ($targetUser['email'] ?? ''))) {
            admin_json_response(['success' => false, 'error' => 'Email already in use'], 409);
        }
    }

    $users[$index] = $targetUser;
    DataStore::saveUsers($users);
    DataStore::saveInstances($instances);

    admin_json_response(['success' => true, 'user' => $sanitizeUser($targetUser)]);
}

if ($method === 'DELETE') {
    admin_require_permission($currentUser, 'users.delete');
    admin_require_csrf_for_mutation($method);

    $userId = (string) ($body['id'] ?? ($_GET['id'] ?? ''));
    if ($userId === '') {
        admin_json_response(['success' => false, 'error' => 'User id is required'], 422);
    }

    $index = $findUserIndexById($users, $userId);
    if ($index === null) {
        admin_json_response(['success' => false, 'error' => 'User not found'], 404);
    }

    $targetUser = $users[$index];

    if (Permissions::isRoot($targetUser) || (($targetUser['protected'] ?? false) === true)) {
        admin_json_response(['success' => false, 'error' => 'Protected root account cannot be deleted'], 403);
    }

    if (($targetUser['id'] ?? '') === ($currentUser['id'] ?? '')) {
        admin_json_response(['success' => false, 'error' => 'You cannot delete your own account'], 403);
    }

    array_splice($users, $index, 1);

    foreach ($instances as &$instance) {
        $admins = is_array($instance['admins'] ?? null) ? $instance['admins'] : [];
        $instance['admins'] = array_values(array_filter($admins, static function ($adminId) use ($userId): bool {
            return (string) $adminId !== $userId;
        }));

        if (!in_array('root', $instance['admins'], true)) {
            $instance['admins'][] = 'root';
        }

        if (($instance['owner'] ?? '') === $userId) {
            $instance['owner'] = 'root';
        }
    }
    unset($instance);

    DataStore::saveUsers($users);
    DataStore::saveInstances($instances);

    admin_json_response(['success' => true]);
}

admin_json_response(['success' => false, 'error' => 'Unsupported request'], 400);

