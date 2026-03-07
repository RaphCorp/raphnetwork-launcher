<?php

declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';
admin_security_headers();

$method = admin_require_method(['GET', 'POST']);
$action = strtolower((string) ($_GET['action'] ?? ($method === 'POST' ? 'login' : 'me')));

if ($action === 'login') {
    if ($method !== 'POST') {
        admin_json_response(['success' => false, 'error' => 'Method not allowed'], 405);
    }

    $payload = admin_parse_body();

    try {
        $username = Validator::username(Validator::requireString($payload, 'username', 3, 32));
        $password = Validator::requireString($payload, 'password', 8, 255);
    } catch (InvalidArgumentException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
    }

    $user = Auth::login($username, $password);
    if ($user === null) {
        admin_json_response(['success' => false, 'error' => 'Invalid credentials'], 401);
    }

    if (!Permissions::canAccessAdminPanel($user)) {
        Auth::logout();
        admin_json_response(['success' => false, 'error' => 'User has no admin access'], 403);
    }

    admin_json_response([
        'success' => true,
        'user' => $user,
        'csrf_token' => Auth::ensureCsrfToken(),
    ]);
}

if ($action === 'logout') {
    if ($method !== 'POST') {
        admin_json_response(['success' => false, 'error' => 'Method not allowed'], 405);
    }

    $user = admin_require_auth();
    admin_require_csrf_for_mutation($method);

    Auth::logout();
    admin_json_response([
        'success' => true,
        'message' => 'Logged out',
        'user' => admin_public_user($user),
    ]);
}

if ($action === 'me') {
    $user = Auth::currentUser();

    if ($user === null || !Permissions::canAccessAdminPanel($user)) {
        admin_json_response([
            'success' => true,
            'authenticated' => false,
        ]);
    }

    admin_json_response([
        'success' => true,
        'authenticated' => true,
        'user' => admin_public_user($user),
        'csrf_token' => Auth::ensureCsrfToken(),
    ]);
}

admin_json_response(['success' => false, 'error' => 'Unknown action'], 400);
