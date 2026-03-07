<?php

declare(strict_types=1);

final class Auth
{
    private const SESSION_USER_ID = 'admin_user_id';
    private const SESSION_CSRF = 'admin_csrf_token';

    public static function configureSession(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        $isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (($_SERVER['SERVER_PORT'] ?? '') === '443');

        session_name('RaphAdminSession');
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'secure' => $isSecure,
            'httponly' => true,
            'samesite' => 'Strict',
        ]);

        session_start();
    }

    public static function login(string $username, string $password): ?array
    {
        $users = DataStore::loadUsers();
        foreach ($users as $user) {
            if (($user['username'] ?? '') !== $username) {
                continue;
            }

            $hash = (string) ($user['password_hash'] ?? '');
            if ($hash === '' || !password_verify($password, $hash)) {
                return null;
            }

            session_regenerate_id(true);
            $_SESSION[self::SESSION_USER_ID] = (string) $user['id'];
            self::ensureCsrfToken();

            return self::publicUser($user);
        }

        return null;
    }

    public static function logout(): void
    {
        $_SESSION = [];

        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                time() - 42000,
                $params['path'],
                $params['domain'],
                (bool) $params['secure'],
                (bool) $params['httponly']
            );
        }

        session_destroy();
    }

    public static function currentUser(): ?array
    {
        $userId = (string) ($_SESSION[self::SESSION_USER_ID] ?? '');
        if ($userId === '') {
            return null;
        }

        $users = DataStore::loadUsers();
        foreach ($users as $user) {
            if (($user['id'] ?? '') === $userId) {
                return $user;
            }
        }

        return null;
    }

    public static function requireAuthenticatedUser(): array
    {
        $user = self::currentUser();
        if ($user === null) {
            throw new RuntimeException('Authentication required');
        }

        if (!Permissions::canAccessAdminPanel($user)) {
            throw new RuntimeException('Admin access denied');
        }

        return $user;
    }

    public static function ensureCsrfToken(): string
    {
        $token = (string) ($_SESSION[self::SESSION_CSRF] ?? '');
        if ($token === '') {
            $token = bin2hex(random_bytes(32));
            $_SESSION[self::SESSION_CSRF] = $token;
        }

        return $token;
    }

    public static function validateCsrfToken(?string $token): bool
    {
        $sessionToken = (string) ($_SESSION[self::SESSION_CSRF] ?? '');
        if ($sessionToken === '' || !is_string($token) || $token === '') {
            return false;
        }

        return hash_equals($sessionToken, $token);
    }

    public static function publicUser(array $user): array
    {
        unset($user['password_hash']);
        $user['permissions'] = Permissions::effectivePermissions($user);
        return $user;
    }
}
