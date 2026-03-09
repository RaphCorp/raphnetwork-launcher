<?php

declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';
admin_security_headers();

$method = admin_require_method(['GET', 'PATCH']);
$currentUser = admin_require_auth();
$body = admin_parse_body();

$loadLauncherConfigModule = static function (): void {
    static $loaded = false;

    if ($loaded === true || function_exists('raph_launcher_effective_payload_for_name')) {
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

$instanceId = (string) ($_GET['instance_id'] ?? ($body['instance_id'] ?? ''));
if ($instanceId === '') {
    admin_json_response(['success' => false, 'error' => 'instance_id is required'], 422);
}

$instances = DataStore::loadInstances();
$instance = DataStore::findInstanceById($instances, $instanceId);
if ($instance === null) {
    admin_json_response(['success' => false, 'error' => 'Instance not found'], 404);
}

if (!Permissions::canAccessInstance($currentUser, $instance)) {
    admin_json_response(['success' => false, 'error' => 'Forbidden'], 403);
}

admin_require_permission($currentUser, 'instance.manage', $instanceId);

$instanceName = trim((string) ($instance['name'] ?? ''));
if ($instanceName === '') {
    admin_json_response(['success' => false, 'error' => 'Instance has no valid name'], 422);
}

if ($method === 'GET') {
    try {
        $loadLauncherConfigModule();
        $launcher = raph_launcher_effective_payload_for_name($instanceName);
    } catch (InvalidArgumentException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
    } catch (RuntimeException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 500);
    }

    admin_json_response([
        'success' => true,
        'instance_id' => $instanceId,
        'instance_name' => $instanceName,
        'launcher' => $launcher,
    ]);
}

admin_require_csrf_for_mutation($method);

$launcherPayload = $body['launcher'] ?? null;
if (!is_array($launcherPayload)) {
    admin_json_response(['success' => false, 'error' => 'launcher payload is required'], 422);
}

$allowedTopLevel = ['loader', 'verify', 'ignored', 'whitelist', 'whitelistActive', 'status', 'jvm_args', 'game_args'];
$unknownTopLevel = array_diff(array_keys($launcherPayload), $allowedTopLevel);
if ($unknownTopLevel !== []) {
    admin_json_response(['success' => false, 'error' => 'Unsupported launcher keys: ' . implode(', ', $unknownTopLevel)], 422);
}

if (isset($launcherPayload['loader']) && is_array($launcherPayload['loader'])) {
    $unknownLoader = array_diff(array_keys($launcherPayload['loader']), ['minecraft_version', 'loader_type', 'loader_version']);
    if ($unknownLoader !== []) {
        admin_json_response(['success' => false, 'error' => 'Unsupported loader keys: ' . implode(', ', $unknownLoader)], 422);
    }
}

if (isset($launcherPayload['status']) && is_array($launcherPayload['status'])) {
    $unknownStatus = array_diff(array_keys($launcherPayload['status']), ['nameServer', 'ip', 'port']);
    if ($unknownStatus !== []) {
        admin_json_response(['success' => false, 'error' => 'Unsupported status keys: ' . implode(', ', $unknownStatus)], 422);
    }
}

try {
    $loadLauncherConfigModule();
    $launcher = raph_launcher_update_json_payload($instanceName, $launcherPayload);
} catch (InvalidArgumentException $exception) {
    admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
} catch (RuntimeException $exception) {
    admin_json_response(['success' => false, 'error' => $exception->getMessage()], 500);
}

admin_json_response([
    'success' => true,
    'instance_id' => $instanceId,
    'instance_name' => $instanceName,
    'launcher' => $launcher,
]);
