<?php

declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';
admin_security_headers();

$method = admin_require_method(['GET', 'PATCH']);
$currentUser = admin_require_auth();
$body = admin_parse_body();

$defaultLauncher = static function (string $instanceName): array {
    return [
        'loader' => [
            'minecraft_version' => '1.21.1',
            'loader_type' => 'vanilla',
            'loader_version' => 'latest',
        ],
        'verify' => true,
        'ignored' => [
            'essential',
            'logs',
            'resourcepacks',
            'saves',
            'screenshots',
            'shaderpacks',
            'W-OVERFLOW',
            'options.txt',
            'optionsof.txt',
        ],
        'whitelist' => [],
        'whitelistActive' => false,
        'status' => [
            'nameServer' => $instanceName,
            'ip' => '',
            'port' => 25565,
        ],
        'jvm_args' => [],
        'game_args' => [],
    ];
};

$normalizeList = static function ($value): array {
    if (!is_array($value)) {
        return [];
    }

    $items = [];
    foreach ($value as $item) {
        if (!is_scalar($item)) {
            continue;
        }
        $normalized = trim((string) $item);
        if ($normalized !== '') {
            $items[] = $normalized;
        }
    }

    return array_values(array_unique($items));
};

$normalizeLauncher = static function (array $source, string $instanceName) use ($defaultLauncher, $normalizeList): array {
    $defaults = $defaultLauncher($instanceName);

    $loader = is_array($source['loader'] ?? null) ? $source['loader'] : [];
    $status = is_array($source['status'] ?? null) ? $source['status'] : [];

    $loaderType = strtolower(trim((string) ($loader['loader_type'] ?? $defaults['loader']['loader_type'])));
    if (!in_array($loaderType, ['vanilla', 'forge', 'fabric', 'quilt', 'neoforge'], true)) {
        $loaderType = $defaults['loader']['loader_type'];
    }

    $portRaw = $status['port'] ?? $defaults['status']['port'];
    $port = is_numeric($portRaw) ? (int) $portRaw : (int) $defaults['status']['port'];
    if ($port < 1 || $port > 65535) {
        $port = (int) $defaults['status']['port'];
    }

    return [
        'loader' => [
            'minecraft_version' => trim((string) ($loader['minecraft_version'] ?? $defaults['loader']['minecraft_version'])) ?: $defaults['loader']['minecraft_version'],
            'loader_type' => $loaderType,
            'loader_version' => trim((string) ($loader['loader_version'] ?? $defaults['loader']['loader_version'])) ?: $defaults['loader']['loader_version'],
        ],
        'verify' => Validator::boolValue($source['verify'] ?? $defaults['verify']),
        'ignored' => $normalizeList($source['ignored'] ?? $defaults['ignored']),
        'whitelist' => $normalizeList($source['whitelist'] ?? $defaults['whitelist']),
        'whitelistActive' => Validator::boolValue($source['whitelistActive'] ?? $defaults['whitelistActive']),
        'status' => [
            'nameServer' => trim((string) ($status['nameServer'] ?? $defaults['status']['nameServer'])) ?: $defaults['status']['nameServer'],
            'ip' => trim((string) ($status['ip'] ?? $defaults['status']['ip'])),
            'port' => $port,
        ],
        'jvm_args' => $normalizeList($source['jvm_args'] ?? $defaults['jvm_args']),
        'game_args' => $normalizeList($source['game_args'] ?? $defaults['game_args']),
    ];
};

$mergeLauncherPatch = static function (array $existing, array $patch): array {
    $result = $existing;

    if (array_key_exists('loader', $patch) && is_array($patch['loader'])) {
        $result['loader'] = is_array($result['loader'] ?? null) ? $result['loader'] : [];
        foreach (['minecraft_version', 'loader_type', 'loader_version'] as $loaderKey) {
            if (array_key_exists($loaderKey, $patch['loader'])) {
                $result['loader'][$loaderKey] = $patch['loader'][$loaderKey];
            }
        }
    }

    foreach (['verify', 'ignored', 'whitelist', 'whitelistActive', 'jvm_args', 'game_args'] as $key) {
        if (array_key_exists($key, $patch)) {
            $result[$key] = $patch[$key];
        }
    }

    if (array_key_exists('status', $patch) && is_array($patch['status'])) {
        $result['status'] = is_array($result['status'] ?? null) ? $result['status'] : [];
        foreach (['nameServer', 'ip', 'port'] as $statusKey) {
            if (array_key_exists($statusKey, $patch['status'])) {
                $result['status'][$statusKey] = $patch['status'][$statusKey];
            }
        }
    }

    return $result;
};

$resolveLegacyFile = static function (): string {
    $candidates = [
        __DIR__ . '/../../instances/php/instances.php',
        __DIR__ . '/../../instances/instances.php',
        dirname(__DIR__, 3) . '/instances/php/instances.php',
        dirname(__DIR__, 3) . '/instances/instances.php',
        dirname(__DIR__, 2) . '/instances/php/instances.php',
        dirname(__DIR__, 2) . '/instances/instances.php',
    ];

    foreach ($candidates as $candidate) {
        if (is_file($candidate)) {
            return $candidate;
        }
    }

    return $candidates[0];
};

$loadLegacyLauncherMap = static function (array $seedNames) use ($resolveLegacyFile, $normalizeLauncher): array {
    $legacyFile = $resolveLegacyFile();

    $allNames = [];
    foreach ($seedNames as $name) {
        if (is_string($name) && trim($name) !== '') {
            $allNames[] = trim($name);
        }
    }

    if (is_file($legacyFile)) {
        $contents = (string) @file_get_contents($legacyFile);
        if ($contents !== '') {
            $matches = [];
            if (preg_match_all('/\\$instance\\[["\']([^"\']+)["\']\\]/', $contents, $matches) === 1 || (isset($matches[1]) && is_array($matches[1]))) {
                foreach ($matches[1] as $name) {
                    if (is_string($name) && trim($name) !== '') {
                        $allNames[] = trim($name);
                    }
                }
            }
        }
    }

    $allNames = array_values(array_unique($allNames));

    $instance = [];
    foreach ($allNames as $name) {
        $instance[$name] = ['name' => $name];
    }

    if (is_file($legacyFile)) {
        $previousErrorLevel = error_reporting();
        error_reporting($previousErrorLevel & ~E_WARNING & ~E_NOTICE);
        include $legacyFile;
        error_reporting($previousErrorLevel);
    }

    $map = [];
    foreach ($instance as $name => $entry) {
        if (!is_string($name) || !is_array($entry)) {
            continue;
        }
        $map[$name] = $normalizeLauncher($entry, $name);
    }

    return [$legacyFile, $map];
};

$saveLegacyLauncherMap = static function (array $map, string $legacyFile): void {
    $directory = dirname($legacyFile);
    if (!is_dir($directory) && !@mkdir($directory, 0750, true) && !is_dir($directory)) {
        throw new RuntimeException('Cannot create legacy launcher directory: ' . $directory);
    }

    ksort($map, SORT_NATURAL | SORT_FLAG_CASE);

    $lines = ["<?php"];
    foreach ($map as $instanceName => $payload) {
        if (!is_string($instanceName) || !is_array($payload)) {
            continue;
        }

        $nameLiteral = var_export($instanceName, true);
        $payloadExport = var_export($payload, true);
        $lines[] = '$instance[' . $nameLiteral . '] = array_merge((is_array($instance[' . $nameLiteral . '] ?? null) ? $instance[' . $nameLiteral . '] : array(' . var_export('name', true) . ' => ' . $nameLiteral . ')), ' . $payloadExport . ');';
        $lines[] = '';
    }
    $lines[] = '?>';
    $lines[] = '';

    $output = implode("\n", $lines);
    if (@file_put_contents($legacyFile, $output, LOCK_EX) === false) {
        throw new RuntimeException('Cannot write legacy launcher config file: ' . $legacyFile);
    }
};

$loadLauncherConfigModule = static function (): bool {
    static $loaded = null;

    if ($loaded !== null) {
        return $loaded;
    }

    if (function_exists('raph_launcher_effective_payload_for_name')) {
        $loaded = true;
        return true;
    }

    $candidates = [
        __DIR__ . '/../../instances/php/instance_config.php',
        dirname(__DIR__, 3) . '/instances/php/instance_config.php',
        dirname(__DIR__, 2) . '/instances/php/instance_config.php',
    ];

    foreach ($candidates as $candidate) {
        if (is_file($candidate)) {
            require_once $candidate;
            $loaded = function_exists('raph_launcher_effective_payload_for_name');
            return $loaded;
        }
    }

    $loaded = false;
    return false;
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
        if ($loadLauncherConfigModule()) {
            $launcher = raph_launcher_effective_payload_for_name($instanceName);
        } else {
            [, $legacyMap] = $loadLegacyLauncherMap([$instanceName]);
            $launcher = $legacyMap[$instanceName] ?? $normalizeLauncher([], $instanceName);
        }
    } catch (Throwable $exception) {
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
    if ($loadLauncherConfigModule()) {
        $launcher = raph_launcher_update_json_payload($instanceName, $launcherPayload);
    } else {
        [$legacyFile, $legacyMap] = $loadLegacyLauncherMap([$instanceName]);
        $existing = $legacyMap[$instanceName] ?? $normalizeLauncher([], $instanceName);
        $merged = $mergeLauncherPatch($existing, $launcherPayload);
        $launcher = $normalizeLauncher($merged, $instanceName);
        $legacyMap[$instanceName] = $launcher;
        $saveLegacyLauncherMap($legacyMap, $legacyFile);
    }
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

