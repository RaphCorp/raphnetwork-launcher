<?php

declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';
admin_security_headers();

$method = admin_require_method(['GET', 'POST', 'PATCH', 'DELETE']);
$currentUser = admin_require_auth();
admin_require_permission($currentUser, 'admin.access');

$body = admin_parse_body();
$action = strtolower((string) ($_GET['action'] ?? ($body['action'] ?? 'bundle')));

$webRoot = dirname(__DIR__, 2);
$configFile = $webRoot . '/launcher/config-launcher/config.json';
$newsFile = $webRoot . '/launcher/news-launcher/news.json';

$readJson = static function (string $path, $default) {
    if (!file_exists($path)) {
        return $default;
    }

    $handle = @fopen($path, 'rb');
    if ($handle === false) {
        throw new RuntimeException('Unable to open file: ' . $path);
    }

    try {
        if (!flock($handle, LOCK_SH)) {
            throw new RuntimeException('Unable to lock file for read: ' . $path);
        }

        $raw = stream_get_contents($handle);
        flock($handle, LOCK_UN);
    } finally {
        fclose($handle);
    }

    $decoded = json_decode((string) $raw, true);
    if ($decoded === null && trim((string) $raw) !== '') {
        throw new RuntimeException('Invalid JSON content in: ' . $path);
    }

    return $decoded ?? $default;
};

$writeJson = static function (string $path, $payload): void {
    $directory = dirname($path);
    if (!is_dir($directory) && !@mkdir($directory, 0750, true) && !is_dir($directory)) {
        throw new RuntimeException('Unable to create directory: ' . $directory);
    }

    $handle = @fopen($path, 'c+b');
    if ($handle === false) {
        throw new RuntimeException('Unable to open file for write: ' . $path);
    }

    try {
        if (!flock($handle, LOCK_EX)) {
            throw new RuntimeException('Unable to lock file for write: ' . $path);
        }

        $encoded = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!is_string($encoded)) {
            throw new RuntimeException('JSON encoding failed for file: ' . $path);
        }

        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, $encoded);
        fflush($handle);
        flock($handle, LOCK_UN);
    } finally {
        fclose($handle);
    }
};

$loadBundle = static function () use ($readJson, $configFile, $newsFile): array {
    $config = $readJson($configFile, []);
    $news = $readJson($newsFile, []);

    if (!is_array($config)) {
        $config = [];
    }

    if (!is_array($news)) {
        $news = [];
    }

    return [
        'config' => $config,
        'news' => array_values($news),
    ];
};

$assertMutationAllowed = static function () use ($currentUser, $method): void {
    if (!Permissions::isRoot($currentUser) && ($currentUser['role'] ?? '') !== Permissions::ROLE_SUPER_ADMIN) {
        admin_json_response(['success' => false, 'error' => 'Only SUPER_ADMIN can modify launcher content'], 403);
    }

    admin_require_csrf_for_mutation($method);
};

$validateNewsItem = static function (array $item, ?array $existing = null): array {
    try {
        $title = Validator::requireString($item, 'title', 1, 140);
        $content = Validator::requireString($item, 'content', 1, 8000);
        $author = Validator::requireString($item, 'author', 1, 120);
    } catch (InvalidArgumentException $exception) {
        throw new RuntimeException($exception->getMessage());
    }

    $publishDate = trim((string) ($item['publish_date'] ?? ''));
    if ($publishDate === '') {
        $publishDate = is_string($existing['publish_date'] ?? null) ? $existing['publish_date'] : DataStore::nowIso();
    }

    if (strtotime($publishDate) === false) {
        throw new RuntimeException('Invalid publish_date format');
    }

    return [
        'title' => $title,
        'content' => $content,
        'author' => $author,
        'publish_date' => gmdate('c', strtotime($publishDate) ?: time()),
    ];
};

if ($method === 'GET') {
    try {
        $bundle = $loadBundle();
    } catch (RuntimeException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 500);
    }

    if ($action === 'config') {
        admin_json_response(['success' => true, 'config' => $bundle['config']]);
    }

    if ($action === 'news') {
        admin_json_response(['success' => true, 'news' => $bundle['news']]);
    }

    admin_json_response(['success' => true, 'launcher' => $bundle]);
}

$assertMutationAllowed();

if ($action === 'config' || $action === 'config.save') {
    try {
        $bundle = $loadBundle();
    } catch (RuntimeException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 500);
    }

    $config = is_array($bundle['config']) ? $bundle['config'] : [];
    $input = is_array($body['config'] ?? null) ? $body['config'] : $body;

    try {
        if (array_key_exists('maintenance', $input)) {
            $config['maintenance'] = Validator::boolValue($input['maintenance']);
        }

        if (array_key_exists('maintenance_message', $input)) {
            $config['maintenance_message'] = Validator::requireString($input, 'maintenance_message', 1, 8000);
        }

        if (array_key_exists('online', $input)) {
            $config['online'] = Validator::requireString($input, 'online', 3, 255);
        }

        if (array_key_exists('client_id', $input)) {
            $config['client_id'] = Validator::requireString($input, 'client_id', 3, 255);
        }

        if (array_key_exists('dataDirectory', $input)) {
            $dataDirectory = Validator::requireString($input, 'dataDirectory', 2, 120);
            if (!preg_match('/^[A-Za-z0-9 _.-]+$/', $dataDirectory)) {
                throw new InvalidArgumentException('Invalid dataDirectory format');
            }
            $config['dataDirectory'] = $dataDirectory;
        }
    } catch (InvalidArgumentException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
    }

    try {
        $writeJson($configFile, $config);
    } catch (RuntimeException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 500);
    }

    admin_json_response(['success' => true, 'config' => $config]);
}

if ($action === 'news.create' && $method === 'POST') {
    $item = is_array($body['item'] ?? null) ? $body['item'] : $body;

    try {
        $bundle = $loadBundle();
        $news = is_array($bundle['news']) ? $bundle['news'] : [];
        $newsItem = $validateNewsItem($item);
        $news[] = $newsItem;
        $writeJson($newsFile, array_values($news));
    } catch (RuntimeException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
    }

    admin_json_response(['success' => true, 'item' => $newsItem, 'news' => array_values($news)], 201);
}

if ($action === 'news.update' && $method === 'PATCH') {
    $index = isset($body['index']) ? (int) $body['index'] : -1;
    $item = is_array($body['item'] ?? null) ? $body['item'] : [];

    try {
        $bundle = $loadBundle();
        $news = is_array($bundle['news']) ? $bundle['news'] : [];

        if ($index < 0 || $index >= count($news)) {
            throw new RuntimeException('Invalid news index');
        }

        $existing = is_array($news[$index]) ? $news[$index] : [];
        $news[$index] = $validateNewsItem($item, $existing);
        $writeJson($newsFile, array_values($news));
    } catch (RuntimeException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
    }

    admin_json_response(['success' => true, 'item' => $news[$index], 'news' => array_values($news)]);
}

if ($action === 'news.delete' && $method === 'DELETE') {
    $index = isset($body['index']) ? (int) $body['index'] : (isset($_GET['index']) ? (int) $_GET['index'] : -1);

    try {
        $bundle = $loadBundle();
        $news = is_array($bundle['news']) ? $bundle['news'] : [];

        if ($index < 0 || $index >= count($news)) {
            throw new RuntimeException('Invalid news index');
        }

        array_splice($news, $index, 1);
        $writeJson($newsFile, array_values($news));
    } catch (RuntimeException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
    }

    admin_json_response(['success' => true, 'news' => array_values($news)]);
}

admin_json_response(['success' => false, 'error' => 'Unsupported launcher action'], 400);