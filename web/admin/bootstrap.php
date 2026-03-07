<?php

declare(strict_types=1);

if (!defined('ADMIN_BOOTSTRAPPED')) {
    define('ADMIN_BOOTSTRAPPED', true);

    require_once __DIR__ . '/lib/DataStore.php';
    require_once __DIR__ . '/lib/Permissions.php';
    require_once __DIR__ . '/lib/Validator.php';
    require_once __DIR__ . '/lib/Auth.php';
    require_once __DIR__ . '/lib/FileManager.php';

    date_default_timezone_set('UTC');

    Auth::configureSession();
    try {
        DataStore::initialize();
    } catch (Throwable $exception) {
        http_response_code(500);
        header('Content-Type: text/plain; charset=UTF-8');
        echo 'Admin bootstrap failed: ' . $exception->getMessage();
        exit;
    }
}

function admin_security_headers(): void
{
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self';");
}

function admin_json_response(array $payload, int $statusCode = 200): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function admin_parse_body(): array
{
    $contentType = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));

    if (strpos($contentType, 'application/json') !== false) {
        $raw = file_get_contents('php://input');
        $data = json_decode((string) $raw, true);
        return is_array($data) ? $data : [];
    }

    return $_POST;
}

function admin_require_method(array $methods): string
{
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if (!in_array($method, $methods, true)) {
        admin_json_response([
            'success' => false,
            'error' => 'Method not allowed',
        ], 405);
    }

    return $method;
}

function admin_require_auth(): array
{
    try {
        return Auth::requireAuthenticatedUser();
    } catch (RuntimeException $exception) {
        admin_json_response([
            'success' => false,
            'error' => $exception->getMessage(),
        ], 401);
    }
}

function admin_require_permission(array $user, string $permission, ?string $instanceId = null): void
{
    if (!Permissions::hasPermission($user, $permission, $instanceId)) {
        admin_json_response([
            'success' => false,
            'error' => 'Forbidden. Missing permission: ' . $permission,
        ], 403);
    }
}

function admin_require_csrf_for_mutation(string $method): void
{
    if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
        $tokenHeader = (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
        $token = $tokenHeader !== '' ? $tokenHeader : (string) ($_POST['csrf_token'] ?? '');

        if (!Auth::validateCsrfToken($token)) {
            admin_json_response([
                'success' => false,
                'error' => 'Invalid CSRF token',
            ], 403);
        }
    }
}

function admin_public_user(array $user): array
{
    return Auth::publicUser($user);
}

function admin_find_instance_or_fail(array $instances, string $instanceId): array
{
    $instance = DataStore::findInstanceById($instances, $instanceId);
    if ($instance === null) {
        admin_json_response([
            'success' => false,
            'error' => 'Instance not found',
        ], 404);
    }

    return $instance;
}

function admin_find_user_or_fail(array $users, string $userId): array
{
    $user = DataStore::findUserById($users, $userId);
    if ($user === null) {
        admin_json_response([
            'success' => false,
            'error' => 'User not found',
        ], 404);
    }

    return $user;
}

