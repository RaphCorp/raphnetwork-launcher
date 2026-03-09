<?php

declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';
admin_security_headers();

$method = admin_require_method(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
$currentUser = admin_require_auth();
$body = admin_parse_body();

$users = DataStore::loadUsers();
$instances = DataStore::loadInstances();

$findInstanceIndexById = static function (array $all, string $id): ?int {
    foreach ($all as $index => $instance) {
        if (($instance['id'] ?? '') === $id) {
            return $index;
        }
    }

    return null;
};

$loadLauncherConfigModule = static function (): void {
    static $loaded = false;

    if ($loaded === true || function_exists('raph_launcher_move_json_key')) {
        $loaded = true;
        return;
    }

    $candidates = [
        __DIR__ . '/../../instances/php/instance_config.php',
        dirname(__DIR__, 3) . '/instances/php/instance_config.php',
        dirname(__DIR__, 2) . '/instances/php/instance_config.php',
    ];

    foreach ($candidates as $candidate) {
        if (is_file($candidate)) {
            require_once $candidate;
            $loaded = true;
            return;
        }
    }

    throw new RuntimeException('Launcher config module not found. Expected instances/php/instance_config.php');
};

$normalizeAdmins = static function (array $adminIds): array {
    $admins = [];
    foreach ($adminIds as $adminId) {
        if (is_string($adminId) && preg_match('/^[A-Za-z0-9_-]+$/', $adminId)) {
            $admins[] = $adminId;
        }
    }

    if (!in_array('root', $admins, true)) {
        $admins[] = 'root';
    }

    return array_values(array_unique($admins));
};

$ensureUserAssignments = static function (string $instanceId, array $assignedUserIds, array $adminUserIds, array &$users): void {
    $assignedUserIds = array_values(array_unique(array_merge($assignedUserIds, $adminUserIds)));

    foreach ($users as &$user) {
        $userId = (string) ($user['id'] ?? '');
        $instancesList = is_array($user['instances'] ?? null) ? $user['instances'] : [];
        $instancesList = array_values(array_unique(array_filter($instancesList, 'is_string')));

        if (in_array($userId, $assignedUserIds, true) || $userId === 'root') {
            if (!in_array($instanceId, $instancesList, true)) {
                $instancesList[] = $instanceId;
            }
        } else {
            $instancesList = array_values(array_filter($instancesList, static function ($candidate) use ($instanceId): bool {
                return $candidate !== $instanceId;
            }));
        }

        $user['instances'] = $instancesList;
    }
    unset($user);
};

if ($method === 'GET') {

    $instanceId = (string) ($_GET['id'] ?? '');
    if ($instanceId !== '') {
        $instance = DataStore::findInstanceById($instances, $instanceId);
        if ($instance === null) {
            admin_json_response(['success' => false, 'error' => 'Instance not found'], 404);
        }

        if (!Permissions::canAccessInstance($currentUser, $instance)) {
            admin_json_response(['success' => false, 'error' => 'Forbidden'], 403);
        }

        admin_require_permission($currentUser, 'instance.view', $instanceId);

        admin_json_response(['success' => true, 'instance' => $instance]);
    }

    $visible = [];
    foreach ($instances as $instance) {
        if (Permissions::canAccessInstance($currentUser, $instance)) {
            $visible[] = $instance;
        }
    }

    admin_json_response(['success' => true, 'instances' => $visible]);
}

if ($method === 'POST') {
    admin_require_permission($currentUser, 'instance.create');
    admin_require_csrf_for_mutation($method);

    try {
        $name = Validator::instanceName(Validator::requireString($body, 'name', 2, 64));
    } catch (InvalidArgumentException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
    }

    foreach ($instances as $existingInstance) {
        if (strtolower((string) ($existingInstance['name'] ?? '')) === strtolower($name)) {
            admin_json_response(['success' => false, 'error' => 'Instance name already exists'], 409);
        }
    }

    $owner = (string) ($body['owner'] ?? $currentUser['id']);
    if (DataStore::findUserById($users, $owner) === null) {
        admin_json_response(['success' => false, 'error' => 'Owner user does not exist'], 422);
    }

    $instanceId = DataStore::generateId('inst');
    $folderName = trim((string) preg_replace('/[^A-Za-z0-9 _.-]+/', '-', $name));
    $folderName = trim($folderName, '. ');
    if ($folderName === '') {
        $folderName = 'instance-' . substr($instanceId, -6);
    }

    $instanceRoot = rtrim(DataStore::getInstancesRoot(), '/');
    $folderPath = $instanceRoot . '/' . $folderName;
    $suffix = 1;
    while (is_dir($folderPath)) {
        $folderPath = $instanceRoot . '/' . $folderName . '-' . $suffix;
        $suffix++;
    }

    if (!mkdir($folderPath, 0750, true) && !is_dir($folderPath)) {
        admin_json_response(['success' => false, 'error' => 'Failed to create instance directory'], 500);
    }

    $admins = is_array($body['admins'] ?? null) ? $body['admins'] : [];
    $admins[] = $owner;
    $admins = $normalizeAdmins($admins);

    $assignedUsers = is_array($body['assigned_users'] ?? null) ? $body['assigned_users'] : [];
    $assignedUsers[] = $owner;
    $assignedUsers[] = 'root';

    $newInstance = [
        'id' => $instanceId,
        'name' => $name,
        'owner' => $owner,
        'admins' => $admins,
        'filesystem_path' => str_replace('\\', '/', realpath($folderPath) ?: $folderPath),
        'created_at' => DataStore::nowIso(),
        'permissions' => [
            'read' => true,
            'write' => true,
            'delete' => true,
            'manage' => true,
        ],
        'status' => 'online',
        'settings' => [
            'maintenance' => false,
            'notes' => '',
        ],
    ];

    $instances[] = $newInstance;
    $ensureUserAssignments($instanceId, $assignedUsers, $admins, $users);

    DataStore::saveInstances($instances);
    DataStore::saveUsers($users);

    admin_json_response(['success' => true, 'instance' => $newInstance], 201);
}

if ($method === 'PUT' || $method === 'PATCH') {
    admin_require_csrf_for_mutation($method);

    $instanceId = (string) ($body['id'] ?? ($_GET['id'] ?? ''));
    if ($instanceId === '') {
        admin_json_response(['success' => false, 'error' => 'Instance id is required'], 422);
    }

    $index = $findInstanceIndexById($instances, $instanceId);
    if ($index === null) {
        admin_json_response(['success' => false, 'error' => 'Instance not found'], 404);
    }

    $instance = $instances[$index];
    $originalInstanceName = (string) ($instance['name'] ?? '');

    if (!Permissions::canAccessInstance($currentUser, $instance)) {
        admin_json_response(['success' => false, 'error' => 'Forbidden'], 403);
    }

    admin_require_permission($currentUser, 'instance.manage', $instanceId);

    try {
        if (array_key_exists('name', $body)) {
            $newName = Validator::instanceName(Validator::requireString($body, 'name', 2, 64));
            foreach ($instances as $candidateIndex => $candidateInstance) {
                if ($candidateIndex === $index) {
                    continue;
                }

                if (strtolower((string) ($candidateInstance['name'] ?? '')) === strtolower($newName)) {
                    admin_json_response(['success' => false, 'error' => 'Instance name already exists'], 409);
                }
            }

            $instance['name'] = $newName;
        }

        if (array_key_exists('owner', $body)) {
            $owner = Validator::userId($body, 'owner');
            if (DataStore::findUserById($users, $owner) === null) {
                admin_json_response(['success' => false, 'error' => 'Owner user does not exist'], 422);
            }
            $instance['owner'] = $owner;
        }

        if (array_key_exists('status', $body)) {
            $status = strtolower(Validator::requireString($body, 'status', 3, 32));
            if (!in_array($status, ['online', 'offline', 'maintenance', 'unknown'], true)) {
                admin_json_response(['success' => false, 'error' => 'Invalid status value'], 422);
            }
            $instance['status'] = $status;
        }

        if (array_key_exists('permissions', $body) && is_array($body['permissions'])) {
            $instance['permissions'] = [
                'read' => Validator::boolValue($body['permissions']['read'] ?? true),
                'write' => Validator::boolValue($body['permissions']['write'] ?? true),
                'delete' => Validator::boolValue($body['permissions']['delete'] ?? true),
                'manage' => Validator::boolValue($body['permissions']['manage'] ?? true),
            ];
        }

        if (array_key_exists('settings', $body) && is_array($body['settings'])) {
            $currentSettings = is_array($instance['settings'] ?? null) ? $instance['settings'] : [];
            $instance['settings'] = array_merge($currentSettings, $body['settings']);
        }

        $admins = is_array($body['admins'] ?? null) ? $normalizeAdmins($body['admins']) : (is_array($instance['admins'] ?? null) ? $normalizeAdmins($instance['admins']) : ['root']);
        if (($instance['owner'] ?? '') !== '' && !in_array($instance['owner'], $admins, true)) {
            $admins[] = (string) $instance['owner'];
        }
        $instance['admins'] = $normalizeAdmins($admins);

        $assignedUsers = is_array($body['assigned_users'] ?? null) ? $body['assigned_users'] : [];
        $assignedUsers[] = (string) ($instance['owner'] ?? 'root');
        $assignedUsers[] = 'root';

        $ensureUserAssignments($instanceId, $assignedUsers, $instance['admins'], $users);
    } catch (InvalidArgumentException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
    }

    $instances[$index] = $instance;
    DataStore::saveInstances($instances);
    DataStore::saveUsers($users);

    $updatedInstanceName = (string) ($instance['name'] ?? '');
    if ($originalInstanceName !== '' && $updatedInstanceName !== '' && $updatedInstanceName !== $originalInstanceName) {
        try {
            $loadLauncherConfigModule();
            if (function_exists('raph_launcher_move_json_key')) {
                raph_launcher_move_json_key($originalInstanceName, $updatedInstanceName);
            }
        } catch (Throwable $exception) {
            admin_json_response(['success' => false, 'error' => 'Instance updated but launcher metadata rename failed: ' . $exception->getMessage()], 500);
        }
    }

    admin_json_response(['success' => true, 'instance' => $instance]);
}

if ($method === 'DELETE') {
    admin_require_csrf_for_mutation($method);

    $settings = DataStore::loadSettings();
    if (($settings['allow_instance_delete'] ?? true) !== true) {
        admin_json_response(['success' => false, 'error' => 'Instance deletion is disabled by system policy'], 403);
    }

    $instanceId = (string) ($body['id'] ?? ($_GET['id'] ?? ''));
    if ($instanceId === '') {
        admin_json_response(['success' => false, 'error' => 'Instance id is required'], 422);
    }

    $index = $findInstanceIndexById($instances, $instanceId);
    if ($index === null) {
        admin_json_response(['success' => false, 'error' => 'Instance not found'], 404);
    }

    $instance = $instances[$index];

    if (!Permissions::canAccessInstance($currentUser, $instance)) {
        admin_json_response(['success' => false, 'error' => 'Forbidden'], 403);
    }

    admin_require_permission($currentUser, 'instance.delete', $instanceId);

    $removeFiles = Validator::boolValue($body['remove_files'] ?? false);

    if ($removeFiles) {
        try {
            $base = FileManager::instanceBasePath($instance);
            FileManager::deleteDirectoryRecursively($base);
        } catch (RuntimeException $exception) {
            admin_json_response(['success' => false, 'error' => 'Failed to remove instance files: ' . $exception->getMessage()], 500);
        }
    }

    array_splice($instances, $index, 1);

    foreach ($users as &$user) {
        $assignedInstances = is_array($user['instances'] ?? null) ? $user['instances'] : [];
        $user['instances'] = array_values(array_filter($assignedInstances, static function ($candidate) use ($instanceId): bool {
            return $candidate !== $instanceId;
        }));

        $instancePermissions = is_array($user['instance_permissions'] ?? null) ? $user['instance_permissions'] : [];
        unset($instancePermissions[$instanceId]);
        $user['instance_permissions'] = $instancePermissions;
    }
    unset($user);

    DataStore::saveInstances($instances);
    DataStore::saveUsers($users);

    admin_json_response(['success' => true]);
}

admin_json_response(['success' => false, 'error' => 'Unsupported request'], 400);




