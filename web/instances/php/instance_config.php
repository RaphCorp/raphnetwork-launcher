<?php

declare(strict_types=1);

if (!function_exists('raph_launcher_config_file')) {
    function raph_launcher_config_file(): string
    {
        return __DIR__ . '/instances.config.json';
    }

    function raph_launcher_legacy_file(): string
    {
        return __DIR__ . '/instances.php';
    }

    function raph_launcher_config_mode(): string
    {
        // Force legacy backend storage for compatibility with existing instances.php workflows.
        return 'legacy';
    }

    function raph_launcher_is_legacy_mode(): bool
    {
        return raph_launcher_config_mode() === 'legacy';
    }

    function raph_launcher_instances_root(): string
    {
        return dirname(__DIR__) . '/instances';
    }

    function raph_launcher_allowed_loader_types(): array
    {
        return ['vanilla', 'forge', 'fabric', 'quilt', 'neoforge'];
    }

    function raph_launcher_default_ignored(): array
    {
        return [
            'essential',
            'logs',
            'resourcepacks',
            'saves',
            'screenshots',
            'shaderpacks',
            'W-OVERFLOW',
            'options.txt',
            'optionsof.txt',
        ];
    }

    function raph_launcher_default_payload(string $instanceName): array
    {
        return [
            'loader' => [
                'minecraft_version' => '1.21.1',
                'loader_type' => 'vanilla',
                'loader_version' => 'latest',
            ],
            'verify' => true,
            'ignored' => raph_launcher_default_ignored(),
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
    }

    function raph_launcher_clean_text(string $value, int $maxLength, string $field): string
    {
        $value = trim($value);
        if ($value === '') {
            throw new InvalidArgumentException('Invalid ' . $field . ': value is empty');
        }

        if (strlen($value) > $maxLength) {
            throw new InvalidArgumentException('Invalid ' . $field . ': value is too long');
        }

        if (preg_match('/[\x00-\x1F\x7F]/', $value) === 1) {
            throw new InvalidArgumentException('Invalid ' . $field . ': contains control characters');
        }

        return $value;
    }

    function raph_launcher_clean_list($value, string $field, int $maxItems = 512, int $maxLength = 255): array
    {
        if (!is_array($value)) {
            throw new InvalidArgumentException('Invalid ' . $field . ': expected an array');
        }

        $items = [];
        foreach ($value as $item) {
            if (!is_scalar($item)) {
                throw new InvalidArgumentException('Invalid ' . $field . ': list contains non-scalar values');
            }

            $itemValue = trim((string) $item);
            if ($itemValue === '') {
                continue;
            }

            if (strlen($itemValue) > $maxLength) {
                throw new InvalidArgumentException('Invalid ' . $field . ': list item is too long');
            }

            if (preg_match('/[\x00-\x1F\x7F]/', $itemValue) === 1) {
                throw new InvalidArgumentException('Invalid ' . $field . ': list contains control characters');
            }

            $items[] = $itemValue;
            if (count($items) > $maxItems) {
                throw new InvalidArgumentException('Invalid ' . $field . ': too many items');
            }
        }

        return array_values(array_unique($items));
    }

    function raph_launcher_clean_loader_type(string $value): string
    {
        $value = strtolower(trim($value));
        if (!in_array($value, raph_launcher_allowed_loader_types(), true)) {
            throw new InvalidArgumentException('Invalid loader.loader_type');
        }

        return $value;
    }

    function raph_launcher_clean_port($value): int
    {
        if (is_int($value)) {
            $port = $value;
        } elseif (is_string($value) && preg_match('/^\d+$/', trim($value)) === 1) {
            $port = (int) trim($value);
        } else {
            throw new InvalidArgumentException('Invalid status.port');
        }

        if ($port < 1 || $port > 65535) {
            throw new InvalidArgumentException('Invalid status.port');
        }

        return $port;
    }

    function raph_launcher_normalize_partial(array $raw, string $instanceName): array
    {
        $normalized = [];

        if (array_key_exists('loader', $raw)) {
            if (!is_array($raw['loader'])) {
                throw new InvalidArgumentException('Invalid launcher.loader');
            }

            $loader = [];
            if (array_key_exists('minecraft_version', $raw['loader'])) {
                $value = raph_launcher_clean_text((string) $raw['loader']['minecraft_version'], 32, 'loader.minecraft_version');
                if (preg_match('/^[0-9A-Za-z._-]+$/', $value) !== 1) {
                    throw new InvalidArgumentException('Invalid loader.minecraft_version');
                }
                $loader['minecraft_version'] = $value;
            }

            if (array_key_exists('loader_type', $raw['loader'])) {
                $loader['loader_type'] = raph_launcher_clean_loader_type((string) $raw['loader']['loader_type']);
            }

            if (array_key_exists('loader_version', $raw['loader'])) {
                $value = raph_launcher_clean_text((string) $raw['loader']['loader_version'], 64, 'loader.loader_version');
                if (preg_match('/^[0-9A-Za-z.+_-]+$/', $value) !== 1) {
                    throw new InvalidArgumentException('Invalid loader.loader_version');
                }
                $loader['loader_version'] = $value;
            }

            if ($loader !== []) {
                $normalized['loader'] = $loader;
            }
        }

        if (array_key_exists('verify', $raw)) {
            $normalized['verify'] = filter_var($raw['verify'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if (!is_bool($normalized['verify'])) {
                throw new InvalidArgumentException('Invalid verify value');
            }
        }

        if (array_key_exists('ignored', $raw)) {
            $normalized['ignored'] = raph_launcher_clean_list($raw['ignored'], 'ignored');
        }

        if (array_key_exists('whitelist', $raw)) {
            $whitelist = raph_launcher_clean_list($raw['whitelist'], 'whitelist', 512, 32);
            foreach ($whitelist as $username) {
                if (preg_match('/^[A-Za-z0-9_]{1,32}$/', $username) !== 1) {
                    throw new InvalidArgumentException('Invalid whitelist username: ' . $username);
                }
            }
            $normalized['whitelist'] = $whitelist;
        }

        if (array_key_exists('whitelistActive', $raw)) {
            $normalized['whitelistActive'] = filter_var($raw['whitelistActive'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if (!is_bool($normalized['whitelistActive'])) {
                throw new InvalidArgumentException('Invalid whitelistActive value');
            }
        }

        if (array_key_exists('status', $raw)) {
            if (!is_array($raw['status'])) {
                throw new InvalidArgumentException('Invalid launcher.status');
            }

            $status = [];
            if (array_key_exists('nameServer', $raw['status'])) {
                $status['nameServer'] = raph_launcher_clean_text((string) $raw['status']['nameServer'], 80, 'status.nameServer');
            }

            if (array_key_exists('ip', $raw['status'])) {
                $ip = raph_launcher_clean_text((string) $raw['status']['ip'], 255, 'status.ip');
                if (preg_match('/^[A-Za-z0-9._:-]+$/', $ip) !== 1) {
                    throw new InvalidArgumentException('Invalid status.ip');
                }
                $status['ip'] = $ip;
            }

            if (array_key_exists('port', $raw['status'])) {
                $status['port'] = raph_launcher_clean_port($raw['status']['port']);
            }

            if ($status !== []) {
                $normalized['status'] = $status;
            }
        }

        if (array_key_exists('jvm_args', $raw)) {
            $normalized['jvm_args'] = raph_launcher_clean_list($raw['jvm_args'], 'jvm_args', 256, 256);
        }

        if (array_key_exists('game_args', $raw)) {
            $normalized['game_args'] = raph_launcher_clean_list($raw['game_args'], 'game_args', 256, 256);
        }


        return $normalized;
    }

    function raph_launcher_merge_payload(array $base, array $overlay): array
    {
        $merged = $base;

        foreach ($overlay as $key => $value) {
            if (is_array($value) && isset($merged[$key]) && is_array($merged[$key]) && in_array($key, ['loader', 'status'], true)) {
                $merged[$key] = array_merge($merged[$key], $value);
                continue;
            }

            $merged[$key] = $value;
        }

        return $merged;
    }

    function raph_launcher_normalize_full(array $raw, string $instanceName): array
    {
        $defaults = raph_launcher_default_payload($instanceName);
        $partial = raph_launcher_normalize_partial($raw, $instanceName);
        $merged = raph_launcher_merge_payload($defaults, $partial);

        return [
            'loader' => [
                'minecraft_version' => (string) $merged['loader']['minecraft_version'],
                'loader_type' => (string) $merged['loader']['loader_type'],
                'loader_version' => (string) $merged['loader']['loader_version'],
            ],
            'verify' => (bool) $merged['verify'],
            'ignored' => is_array($merged['ignored']) ? array_values($merged['ignored']) : [],
            'whitelist' => is_array($merged['whitelist']) ? array_values($merged['whitelist']) : [],
            'whitelistActive' => (bool) $merged['whitelistActive'],
            'status' => [
                'nameServer' => (string) $merged['status']['nameServer'],
                'ip' => (string) $merged['status']['ip'],
                'port' => (int) $merged['status']['port'],
            ],
            'jvm_args' => is_array($merged['jvm_args']) ? array_values($merged['jvm_args']) : [],
            'game_args' => is_array($merged['game_args']) ? array_values($merged['game_args']) : [],
        ];
    }

    function raph_launcher_load_json_map_raw(): array
    {
        $file = raph_launcher_config_file();
        if (!file_exists($file)) {
            return [];
        }

        $handle = @fopen($file, 'rb');
        if ($handle === false) {
            throw new RuntimeException('Cannot open launcher config file: ' . $file);
        }

        try {
            if (!flock($handle, LOCK_SH)) {
                throw new RuntimeException('Cannot lock launcher config file for read: ' . $file);
            }

            $raw = stream_get_contents($handle);
            flock($handle, LOCK_UN);
        } finally {
            fclose($handle);
        }

        $decoded = json_decode((string) $raw, true);
        if (!is_array($decoded)) {
            return [];
        }

        $map = [];
        foreach ($decoded as $instanceName => $value) {
            if (!is_string($instanceName) || !is_array($value)) {
                continue;
            }
            $map[$instanceName] = $value;
        }

        return $map;
    }

    function raph_launcher_load_json_map_full(): array
    {
        $raw = raph_launcher_load_json_map_raw();
        $full = [];
        foreach ($raw as $instanceName => $payload) {
            $full[$instanceName] = raph_launcher_normalize_full($payload, $instanceName);
        }

        return $full;
    }

    function raph_launcher_save_json_map(array $map): void
    {
        $file = raph_launcher_config_file();
        $directory = dirname($file);
        if (!is_dir($directory) && !@mkdir($directory, 0750, true) && !is_dir($directory)) {
            throw new RuntimeException('Cannot create launcher config directory: ' . $directory);
        }

        $output = [];
        foreach ($map as $instanceName => $payload) {
            if (!is_string($instanceName) || !is_array($payload)) {
                continue;
            }
            $output[$instanceName] = raph_launcher_normalize_full($payload, $instanceName);
        }

        ksort($output, SORT_NATURAL | SORT_FLAG_CASE);

        $encoded = json_encode($output, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        if (!is_string($encoded)) {
            throw new RuntimeException('Failed to encode launcher config JSON');
        }

        $handle = @fopen($file, 'c+b');
        if ($handle === false) {
            throw new RuntimeException('Cannot open launcher config file for write: ' . $file);
        }

        try {
            if (!flock($handle, LOCK_EX)) {
                throw new RuntimeException('Cannot lock launcher config file for write: ' . $file);
            }

            ftruncate($handle, 0);
            rewind($handle);
            fwrite($handle, $encoded);
            fflush($handle);
            flock($handle, LOCK_UN);
        } finally {
            fclose($handle);
        }
    }

    function raph_launcher_move_json_key(string $oldName, string $newName): void
    {
        $oldName = trim($oldName);
        $newName = trim($newName);
        if ($oldName === '' || $newName === '' || $oldName === $newName) {
            return;
        }

        if (raph_launcher_is_legacy_mode()) {
            raph_launcher_move_legacy_key($oldName, $newName);
            return;
        }

        $raw = raph_launcher_load_json_map_raw();
        if (!array_key_exists($oldName, $raw)) {
            return;
        }

        $payload = is_array($raw[$oldName]) ? $raw[$oldName] : [];
        unset($raw[$oldName]);
        $raw[$newName] = $payload;

        raph_launcher_save_json_map($raw);
    }

    function raph_launcher_scan_instance_names(): array
    {
        $root = raph_launcher_instances_root();
        if (!is_dir($root)) {
            return [];
        }

        $entries = scandir($root);
        if (!is_array($entries)) {
            return [];
        }

        $instances = [];
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }

            $path = $root . '/' . $entry;
            if (!is_dir($path)) {
                continue;
            }

            $instances[] = $entry;
        }

        sort($instances, SORT_NATURAL | SORT_FLAG_CASE);
        return $instances;
    }

    function raph_launcher_extract_partial_from_instance_entry(array $instanceEntry, string $instanceName): array
    {
        $candidate = [];
        $keys = ['loader', 'verify', 'ignored', 'whitelist', 'whitelistActive', 'status', 'jvm_args', 'game_args'];

        foreach ($keys as $key) {
            if (array_key_exists($key, $instanceEntry)) {
                $candidate[$key] = $instanceEntry[$key];
            }
        }

        if ($candidate === []) {
            return [];
        }

        return raph_launcher_normalize_partial($candidate, $instanceName);
    }

    function raph_launcher_load_legacy_partial_map(array $baseMap): array
    {
        $instance = $baseMap;
        $legacyFile = raph_launcher_legacy_file();

        if (file_exists($legacyFile)) {
            $previousErrorLevel = error_reporting();
            error_reporting($previousErrorLevel & ~E_WARNING & ~E_NOTICE);
            include $legacyFile;
            error_reporting($previousErrorLevel);
        }

        $legacy = [];
        foreach ($instance as $instanceName => $entry) {
            if (!is_string($instanceName) || !is_array($entry)) {
                continue;
            }

            $partial = raph_launcher_extract_partial_from_instance_entry($entry, $instanceName);
            if ($partial !== []) {
                $legacy[$instanceName] = $partial;
            }
        }

        return $legacy;
    }

    function raph_launcher_load_legacy_custom_map(array $instanceNames): array
    {
        $baseMap = [];
        foreach ($instanceNames as $instanceName) {
            if (!is_string($instanceName) || $instanceName === '') {
                continue;
            }
            $baseMap[$instanceName] = ['name' => $instanceName];
        }

        $legacyPartials = raph_launcher_load_legacy_partial_map($baseMap);
        $custom = [];
        foreach ($legacyPartials as $instanceName => $payload) {
            if (!is_string($instanceName) || !is_array($payload)) {
                continue;
            }
            $custom[$instanceName] = raph_launcher_normalize_full($payload, $instanceName);
        }

        return $custom;
    }

    function raph_launcher_write_legacy_map(array $legacyMap): void
    {
        $legacyFile = raph_launcher_legacy_file();
        $directory = dirname($legacyFile);
        if (!is_dir($directory) && !@mkdir($directory, 0750, true) && !is_dir($directory)) {
            throw new RuntimeException('Cannot create legacy config directory: ' . $directory);
        }

        ksort($legacyMap, SORT_NATURAL | SORT_FLAG_CASE);

        $lines = ["<?php"];
        foreach ($legacyMap as $instanceName => $payload) {
            if (!is_string($instanceName) || !is_array($payload)) {
                continue;
            }

            $nameLiteral = var_export($instanceName, true);
            $payloadExport = var_export(raph_launcher_normalize_full($payload, $instanceName), true);

            $lines[] = '$instance[' . $nameLiteral . '] = array_merge((is_array($instance[' . $nameLiteral . '] ?? null) ? $instance[' . $nameLiteral . '] : array(' . var_export('name', true) . ' => ' . $nameLiteral . ')), ' . $payloadExport . ');';
            $lines[] = '';
        }
        $lines[] = '?>';
        $lines[] = '';

        $output = implode("\n", $lines);
        if (@file_put_contents($legacyFile, $output, LOCK_EX) === false) {
            throw new RuntimeException('Cannot write legacy launcher config: ' . $legacyFile);
        }
    }

    function raph_launcher_save_legacy_payload(string $instanceName, array $payload): void
    {
        $instanceNames = raph_launcher_scan_instance_names();
        if (!in_array($instanceName, $instanceNames, true)) {
            $instanceNames[] = $instanceName;
        }

        $legacyMap = raph_launcher_load_legacy_custom_map($instanceNames);
        $legacyMap[$instanceName] = raph_launcher_normalize_full($payload, $instanceName);

        raph_launcher_write_legacy_map($legacyMap);
    }

    function raph_launcher_move_legacy_key(string $oldName, string $newName): void
    {
        $oldName = trim($oldName);
        $newName = trim($newName);
        if ($oldName === '' || $newName === '' || $oldName === $newName) {
            return;
        }

        $instanceNames = raph_launcher_scan_instance_names();
        if (!in_array($oldName, $instanceNames, true)) {
            $instanceNames[] = $oldName;
        }
        if (!in_array($newName, $instanceNames, true)) {
            $instanceNames[] = $newName;
        }

        $legacyMap = raph_launcher_load_legacy_custom_map($instanceNames);
        if (!array_key_exists($oldName, $legacyMap)) {
            return;
        }

        $payload = is_array($legacyMap[$oldName]) ? $legacyMap[$oldName] : [];
        unset($legacyMap[$oldName]);
        $legacyMap[$newName] = raph_launcher_normalize_full($payload, $newName);

        raph_launcher_write_legacy_map($legacyMap);
    }
    function raph_launcher_build_payload_map(array $instanceNames, ?callable $urlResolver = null): array
    {
        $baseMap = [];
        foreach ($instanceNames as $instanceName) {
            if (!is_string($instanceName) || $instanceName === '') {
                continue;
            }

            $entry = ['name' => $instanceName];
            if ($urlResolver !== null) {
                $entry['url'] = (string) $urlResolver($instanceName);
            }
            $baseMap[$instanceName] = $entry;
        }

        $legacyMap = raph_launcher_load_legacy_partial_map($baseMap);
        $jsonRawMap = raph_launcher_load_json_map_raw();

        $result = [];
        foreach ($baseMap as $instanceName => $entry) {
            $payload = raph_launcher_default_payload($instanceName);

            if (raph_launcher_is_legacy_mode()) {
                if (isset($jsonRawMap[$instanceName]) && is_array($jsonRawMap[$instanceName])) {
                    try {
                        $jsonPartial = raph_launcher_normalize_partial($jsonRawMap[$instanceName], $instanceName);
                        $payload = raph_launcher_merge_payload($payload, $jsonPartial);
                    } catch (InvalidArgumentException $exception) {
                        // Invalid stored JSON values are ignored to preserve legacy compatibility.
                    }
                }

                if (isset($legacyMap[$instanceName])) {
                    $payload = raph_launcher_merge_payload($payload, $legacyMap[$instanceName]);
                }
            } else {
                if (isset($legacyMap[$instanceName])) {
                    $payload = raph_launcher_merge_payload($payload, $legacyMap[$instanceName]);
                }

                if (isset($jsonRawMap[$instanceName]) && is_array($jsonRawMap[$instanceName])) {
                    try {
                        $jsonPartial = raph_launcher_normalize_partial($jsonRawMap[$instanceName], $instanceName);
                        $payload = raph_launcher_merge_payload($payload, $jsonPartial);
                    } catch (InvalidArgumentException $exception) {
                        // Invalid stored JSON values are ignored to preserve legacy compatibility.
                    }
                }
            }

            $result[$instanceName] = array_merge($entry, raph_launcher_normalize_full($payload, $instanceName));
        }

        return $result;
    }

    function raph_launcher_effective_payload_for_name(string $instanceName): array
    {
        $name = trim($instanceName);
        if ($name === '') {
            throw new InvalidArgumentException('Instance name is required');
        }

        $map = raph_launcher_build_payload_map([$name], null);
        if (isset($map[$name])) {
            return raph_launcher_normalize_full($map[$name], $name);
        }

        return raph_launcher_default_payload($name);
    }

    function raph_launcher_update_json_payload(string $instanceName, array $launcherPatch): array
    {
        $name = trim($instanceName);
        if ($name === '') {
            throw new InvalidArgumentException('Instance name is required');
        }

        $existing = raph_launcher_effective_payload_for_name($name);
        $patch = raph_launcher_normalize_partial($launcherPatch, $name);
        $merged = raph_launcher_merge_payload($existing, $patch);
        $normalized = raph_launcher_normalize_full($merged, $name);

        if (raph_launcher_is_legacy_mode()) {
            raph_launcher_save_legacy_payload($name, $normalized);
            return $normalized;
        }

        $jsonMap = raph_launcher_load_json_map_raw();
        $jsonMap[$name] = $normalized;
        raph_launcher_save_json_map($jsonMap);

        return $normalized;
    }
}







