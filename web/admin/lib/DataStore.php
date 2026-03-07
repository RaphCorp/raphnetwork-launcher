<?php

declare(strict_types=1);

final class DataStore
{
    private const INSTANCES_ROOT = __DIR__ . '/../../instances/instances';

    private static ?string $resolvedDataDir = null;

    public static function initialize(): void
    {
        self::ensureDirectories();
        self::ensureJsonFiles();
        self::ensureRootAccount();
        self::ensureInstancesBootstrap();
        self::ensureSettingsDefaults();
    }

    public static function loadUsers(): array
    {
        $payload = self::loadJson(self::usersFile(), ['users' => []]);
        return is_array($payload['users'] ?? null) ? array_values($payload['users']) : [];
    }

    public static function saveUsers(array $users): void
    {
        self::saveJson(self::usersFile(), ['users' => array_values($users)]);
    }

    public static function loadInstances(): array
    {
        $payload = self::loadJson(self::instancesFile(), ['instances' => []]);
        return is_array($payload['instances'] ?? null) ? array_values($payload['instances']) : [];
    }

    public static function saveInstances(array $instances): void
    {
        self::saveJson(self::instancesFile(), ['instances' => array_values($instances)]);
    }

    public static function loadSettings(): array
    {
        $payload = self::loadJson(self::settingsFile(), ['settings' => []]);
        return is_array($payload['settings'] ?? null) ? $payload['settings'] : [];
    }

    public static function saveSettings(array $settings): void
    {
        self::saveJson(self::settingsFile(), ['settings' => $settings]);
    }

    public static function generateId(string $prefix): string
    {
        return $prefix . '_' . bin2hex(random_bytes(6));
    }

    public static function nowIso(): string
    {
        return gmdate('c');
    }

    public static function getInstancesRoot(): string
    {
        return self::normalizePath(self::INSTANCES_ROOT);
    }

    public static function findUserById(array $users, string $id): ?array
    {
        foreach ($users as $user) {
            if (($user['id'] ?? '') === $id) {
                return $user;
            }
        }

        return null;
    }

    public static function findUserByUsername(array $users, string $username): ?array
    {
        foreach ($users as $user) {
            if (($user['username'] ?? '') === $username) {
                return $user;
            }
        }

        return null;
    }

    public static function findInstanceById(array $instances, string $id): ?array
    {
        foreach ($instances as $instance) {
            if (($instance['id'] ?? '') === $id) {
                return $instance;
            }
        }

        return null;
    }

    public static function indexById(array $items): array
    {
        $map = [];
        foreach ($items as $item) {
            if (isset($item['id']) && is_string($item['id'])) {
                $map[$item['id']] = $item;
            }
        }

        return $map;
    }

    private static function ensureDirectories(): void
    {
        self::dataDir();

        if (!is_dir(self::INSTANCES_ROOT)) {
            @mkdir(self::INSTANCES_ROOT, 0750, true);
        }
    }

    private static function ensureJsonFiles(): void
    {
        self::ensureJsonFile(self::usersFile(), ['users' => []]);
        self::ensureJsonFile(self::instancesFile(), ['instances' => []]);
        self::ensureJsonFile(self::settingsFile(), ['settings' => []]);
    }

    private static function ensureJsonFile(string $file, array $defaultPayload): void
    {
        if (file_exists($file)) {
            return;
        }

        self::saveJson($file, $defaultPayload);
    }

    private static function ensureRootAccount(): void
    {
        $users = self::loadUsers();
        $rootIndex = null;

        foreach ($users as $index => $user) {
            if (($user['username'] ?? '') === 'root') {
                $rootIndex = $index;
                break;
            }
        }

        if ($rootIndex === null) {
            $plainPassword = getenv('ADMIN_ROOT_PASSWORD');
            $passwordIsGenerated = false;

            if (!is_string($plainPassword) || trim($plainPassword) === '') {
                $plainPassword = self::generateStrongPassword();
                $passwordIsGenerated = true;
            }

            $rootUser = [
                'id' => 'root',
                'username' => 'root',
                'email' => 'root@localhost',
                'password_hash' => password_hash($plainPassword, PASSWORD_DEFAULT),
                'role' => 'SUPER_ADMIN',
                'instances' => [],
                'permissions' => ['*'],
                'instance_permissions' => [],
                'created_at' => self::nowIso(),
                'protected' => true,
            ];

            $users[] = $rootUser;
            self::saveUsers($users);

            if ($passwordIsGenerated) {
                $message = "IMPORTANT: initial root credentials\n" .
                    "username: root\n" .
                    "password: {$plainPassword}\n" .
                    "Generated at: " . self::nowIso() . "\n" .
                    "Delete this file after secure storage.\n";
                @file_put_contents(self::rootCredentialsFile(), $message, LOCK_EX);
            }

            return;
        }

        $root = $users[$rootIndex];
        $root['id'] = 'root';
        $root['username'] = 'root';
        $root['role'] = 'SUPER_ADMIN';
        $root['protected'] = true;
        $root['permissions'] = ['*'];
        $root['instance_permissions'] = is_array($root['instance_permissions'] ?? null) ? $root['instance_permissions'] : [];
        $root['instances'] = is_array($root['instances'] ?? null) ? array_values(array_unique($root['instances'])) : [];
        $root['created_at'] = is_string($root['created_at'] ?? null) ? $root['created_at'] : self::nowIso();

        if (!is_string($root['password_hash'] ?? null) || $root['password_hash'] === '') {
            $plainPassword = getenv('ADMIN_ROOT_PASSWORD');
            if (!is_string($plainPassword) || trim($plainPassword) === '') {
                $plainPassword = self::generateStrongPassword();
            }
            $root['password_hash'] = password_hash($plainPassword, PASSWORD_DEFAULT);
        }

        $users[$rootIndex] = $root;
        self::saveUsers($users);
    }

    private static function ensureInstancesBootstrap(): void
    {
        $instances = self::loadInstances();
        $knownByName = [];

        foreach ($instances as $instance) {
            $name = (string) ($instance['name'] ?? '');
            if ($name !== '') {
                $knownByName[$name] = true;
            }
        }

        $directories = self::scanInstanceDirectories();
        $changed = false;

        foreach ($directories as $directory) {
            $name = basename($directory);
            if (isset($knownByName[$name])) {
                continue;
            }

            $instances[] = [
                'id' => self::createInstanceId($name),
                'name' => $name,
                'owner' => 'root',
                'admins' => ['root'],
                'filesystem_path' => self::normalizePath($directory),
                'created_at' => self::nowIso(),
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
            $changed = true;
        }

        if ($changed) {
            self::saveInstances($instances);
        }
    }

    private static function ensureSettingsDefaults(): void
    {
        $settings = self::loadSettings();
        $defaults = [
            'site_name' => 'RaphNetwork Admin',
            'maintenance_mode' => false,
            'session_timeout_minutes' => 120,
            'allow_instance_delete' => true,
            'updated_at' => self::nowIso(),
        ];

        $merged = array_merge($defaults, $settings);

        if ($merged !== $settings) {
            self::saveSettings($merged);
        }
    }

    private static function scanInstanceDirectories(): array
    {
        $root = self::getInstancesRoot();
        if (!is_dir($root)) {
            return [];
        }

        $entries = scandir($root);
        if (!is_array($entries)) {
            return [];
        }

        $directories = [];
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }

            $path = $root . DIRECTORY_SEPARATOR . $entry;
            if (is_dir($path)) {
                $directories[] = $path;
            }
        }

        return $directories;
    }

    private static function createInstanceId(string $name): string
    {
        $slug = strtolower(trim(preg_replace('/[^a-zA-Z0-9]+/', '-', $name), '-'));
        if ($slug === '') {
            $slug = 'instance';
        }

        return 'inst_' . $slug . '_' . substr(sha1($name), 0, 6);
    }

    private static function generateStrongPassword(): string
    {
        $raw = base64_encode(random_bytes(18));
        return rtrim(strtr($raw, '+/', '-_'), '=');
    }

    private static function loadJson(string $file, array $default): array
    {
        if (!file_exists($file)) {
            return $default;
        }

        $handle = fopen($file, 'rb');
        if ($handle === false) {
            return $default;
        }

        try {
            if (!flock($handle, LOCK_SH)) {
                return $default;
            }

            $content = stream_get_contents($handle);
            flock($handle, LOCK_UN);
        } finally {
            fclose($handle);
        }

        if (!is_string($content) || trim($content) === '') {
            return $default;
        }

        $decoded = json_decode($content, true);
        if (!is_array($decoded)) {
            return $default;
        }

        return $decoded;
    }

    private static function saveJson(string $file, array $payload): void
    {
        $directory = dirname($file);
        if (!is_dir($directory) && !@mkdir($directory, 0750, true) && !is_dir($directory)) {
            throw new RuntimeException('Cannot create datastore directory: ' . $directory);
        }

        $handle = @fopen($file, 'c+b');
        if ($handle === false) {
            throw new RuntimeException('Cannot open datastore file: ' . $file . ' (check write permissions)');
        }

        try {
            if (!flock($handle, LOCK_EX)) {
                throw new RuntimeException('Cannot lock datastore file: ' . $file);
            }

            ftruncate($handle, 0);
            rewind($handle);
            fwrite($handle, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
            fflush($handle);
            flock($handle, LOCK_UN);
        } finally {
            fclose($handle);
        }
    }

    private static function dataDir(): string
    {
        if (self::$resolvedDataDir !== null) {
            return self::$resolvedDataDir;
        }

        $candidates = [];
        $envDir = getenv('ADMIN_DATA_DIR');
        if (is_string($envDir) && trim($envDir) !== '') {
            $candidates[] = trim($envDir);
        }

        $candidates[] = __DIR__ . '/../data';
        $candidates[] = dirname(__DIR__, 3) . '/data/raph_admin';
        $candidates[] = sys_get_temp_dir() . '/raph_admin';

        foreach ($candidates as $candidate) {
            $normalized = self::normalizePath($candidate);
            if (self::ensureWritableDirectory($normalized)) {
                self::$resolvedDataDir = rtrim($normalized, '/');
                return self::$resolvedDataDir;
            }
        }

        throw new RuntimeException('No writable admin datastore directory found. Set ADMIN_DATA_DIR to a writable path.');
    }

    private static function ensureWritableDirectory(string $directory): bool
    {
        if (!is_dir($directory)) {
            if (!@mkdir($directory, 0750, true) && !is_dir($directory)) {
                return false;
            }
        }

        if (!is_writable($directory)) {
            $probe = rtrim($directory, '/') . '/.write-test-' . bin2hex(random_bytes(3));
            $result = @file_put_contents($probe, 'test') !== false;
            if ($result) {
                @unlink($probe);
            }
            return $result;
        }

        return true;
    }

    private static function usersFile(): string
    {
        return self::dataDir() . '/users.json';
    }

    private static function instancesFile(): string
    {
        return self::dataDir() . '/instances.json';
    }

    private static function settingsFile(): string
    {
        return self::dataDir() . '/settings.json';
    }

    private static function rootCredentialsFile(): string
    {
        return self::dataDir() . '/root_credentials.txt';
    }

    private static function normalizePath(string $path): string
    {
        $real = realpath($path);
        if ($real !== false) {
            return str_replace('\\', '/', $real);
        }

        return str_replace('\\', '/', $path);
    }
}
